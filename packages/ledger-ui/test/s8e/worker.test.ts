import { describe, expect, test } from "bun:test";
import type { Disclosure, DisclosureFile } from "../../src/data/disclosure.ts";
import { audiences, viewAsValues } from "../../src/data/disclosure.ts";
import {
	assembleDisclosure,
	viewAsOf,
	viewerOf,
} from "../../src/http/disclosure.ts";
import { AdapterError } from "../../src/http/errors.ts";
import type { WorkerLedgerPage } from "../../src/http/worker-source.ts";
import { familyId, profileId, schoolId } from "./helpers.ts";
import {
	issuedAt,
	ledgerTokenAnswer,
	memberRow,
	membersAnswer,
	schoolFactsAnswer,
	tokenLifetime,
} from "./recorded.ts";
import { adapters, workerBase } from "./setup.ts";

/** Section 11's success envelope and error body. */
const envelope = (
	data: unknown,
	asOf: string | null = "2026-11-07T12:00:00Z",
	lagMinutes: number | null = 3,
) => ({ asOf, lagMinutes, data });
const workerError = (
	code: string,
	message: string,
	extra: Record<string, unknown> = {},
) => ({ error: { code, message, ...extra } });
const workerPath = (path: string) =>
	new RegExp(
		`^/v1${path.replace(/[/:]/g, (match) => (match === "/" ? "\\/" : match))}$`,
	);

const rejection = async (promise: Promise<unknown>): Promise<AdapterError> => {
	try {
		await promise;
	} catch (error) {
		if (error instanceof AdapterError) return error;
		throw error;
	}
	throw new Error("expected a rejection");
};
const workerCalls = (http: ReturnType<typeof adapters>["http"]) =>
	http.calls.filter(({ url }) => url.startsWith(workerBase));
const token = ledgerTokenAnswer().token;

describe("the fetch WorkerSource over section 11", () => {
	test("GET only, the ledger token as bearer, the query as section 11 names it, data unwrapped", async () => {
		const { reader, http } = adapters({ worker: "fetch" });
		const document = { school: schoolId, audience: "public" };
		http.on("GET", workerPath(`/schools/${schoolId}/kpi`), {
			status: 200,
			body: envelope(document),
		});
		http.on("GET", workerPath(`/schools/${schoolId}/income-statement`), {
			status: 200,
			body: envelope({ school: schoolId }),
		});
		http.on("GET", workerPath(`/schools/${schoolId}/audience-report`), {
			status: 200,
			body: envelope({ audience: "member" }),
		});
		http.on("GET", workerPath(`/schools/${schoolId}/members-income`), {
			status: 200,
			body: envelope({ cents: 123_400 }),
		});
		expect(
			await reader.kpiDocument({
				school: schoolId,
				preset: "ignored",
				audience: "public",
				pinLocked: true,
			}),
		).toEqual(document as never);
		expect(
			await reader.incomeStatement({
				school: schoolId,
				from: "2026-10-01",
				to: "2026-10-31",
				compare: true,
			}),
		).toEqual({ school: schoolId } as never);
		expect(
			await reader.audienceReport({
				school: schoolId,
				audience: "member",
				from: "2026-01-01",
				to: "2026-03-31",
			}),
		).toEqual({ audience: "member" } as never);
		expect(
			await reader.membersIncome({
				schoolId,
				from: "2026-10-01",
				to: "2026-10-31",
			}),
		).toBe(123_400);
		expect(
			workerCalls(http).map(({ url, method, headers }) => [
				method,
				url.slice(workerBase.length),
				headers.authorization,
			]),
		).toEqual([
			[
				"GET",
				`/schools/${schoolId}/kpi?audience=public&pin=locked`,
				`Bearer ${token}`,
			],
			[
				"GET",
				`/schools/${schoolId}/income-statement?from=2026-10-01&to=2026-10-31&compare=1`,
				`Bearer ${token}`,
			],
			[
				"GET",
				`/schools/${schoolId}/audience-report?audience=member&from=2026-01-01&to=2026-03-31`,
				`Bearer ${token}`,
			],
			[
				"GET",
				`/schools/${schoolId}/members-income?from=2026-10-01&to=2026-10-31`,
				`Bearer ${token}`,
			],
		]);
	});

	test("a 401 mints a new token and tries once more; a second 401 rejects", async () => {
		const { reader, http } = adapters({ worker: "fetch" });
		http.on(
			"GET",
			workerPath(`/schools/${schoolId}/members-income`),
			{ status: 401, body: workerError("token_expired", "expired") },
			{ status: 200, body: envelope({ cents: 5 }) },
			{ status: 401, body: workerError("token_invalid", "bad") },
			{ status: 401, body: workerError("token_invalid", "bad") },
		);
		expect(
			await reader.membersIncome({
				schoolId,
				from: "2026-10-01",
				to: "2026-10-31",
			}),
		).toBe(5);
		expect(
			http.calls.filter(({ url }) => url.endsWith("/ledger-token")),
		).toHaveLength(2);
		expect(
			(
				await rejection(
					reader.membersIncome({
						schoolId,
						from: "2026-10-01",
						to: "2026-10-31",
					}),
				)
			).kind,
		).toBe("unauthenticated");
	});

	test("409 view_mismatch waits retryAfterSeconds and tries once more", async () => {
		const { reader, http, scheduler } = adapters({ worker: "fetch" });
		http.on(
			"GET",
			workerPath(`/schools/${schoolId}/members-income`),
			{
				status: 409,
				body: workerError("view_mismatch", "a run is in flight", {
					retryAfterSeconds: 5,
				}),
			},
			{ status: 200, body: envelope({ cents: 7 }) },
		);
		expect(
			await reader.membersIncome({
				schoolId,
				from: "2026-10-01",
				to: "2026-10-31",
			}),
		).toBe(7);
		expect(scheduler.waits).toEqual([5]);
	});

	const errors: Array<[number, string, AdapterError["kind"]]> = [
		[501, "not_available", "not_available"],
		[404, "no_data", "no_data"],
		[404, "not_found", "not_found"],
		[403, "finance_required", "forbidden"],
		[403, "audience_not_allowed", "forbidden"],
		[400, "bad_request", "bad_request"],
		[429, "rate_limited", "rate_limited"],
		[503, "views_unavailable", "unavailable"],
	];
	for (const [status, code, kind] of errors)
		test(`${status} ${code} rejects ${kind}`, async () => {
			const { reader, http } = adapters({ worker: "fetch" });
			http.on("GET", /^\/v1\//, {
				status,
				body: workerError(
					code,
					"why",
					code === "bad_request" ? { field: "from" } : {},
				),
			});
			const error = await rejection(
				reader.incomeStatement({
					school: schoolId,
					from: "2026-10-01",
					to: "2026-10-31",
					compare: false,
				}),
			);
			expect(error.kind).toBe(kind);
			expect(error.detail.code).toBe(code);
		});

	test("a read's asOf clears the pending writes it shipped", async () => {
		const { reader, writer, http, pending } = adapters({ worker: "fetch" });
		http.on("POST", /credits\/adjust$/, {
			status: 200,
			body: { replayed: false },
		});
		await writer.adjustCredits({
			schoolId,
			membershipId: "m",
			featureId: "sessions",
			amount: 1,
			kind: "gift",
			note: "gift",
		});
		expect(reader.pendingWrites(schoolId)).toHaveLength(1);
		const shipsBy = new Date((issuedAt + tokenLifetime) * 1000).toISOString();
		expect(pending.all()[0]?.shipsBy).toBe(shipsBy);
		http.on(
			"GET",
			workerPath(`/schools/${schoolId}/members-income`),
			{
				status: 200,
				body: envelope({ cents: 1 }, new Date(issuedAt * 1000).toISOString()),
			},
			{ status: 200, body: envelope({ cents: 1 }, shipsBy) },
		);
		await reader.membersIncome({
			schoolId,
			from: "2026-10-01",
			to: "2026-10-31",
		});
		expect(reader.pendingWrites(schoolId)).toHaveLength(1);
		await reader.membersIncome({
			schoolId,
			from: "2026-10-01",
			to: "2026-10-31",
		});
		expect(reader.pendingWrites(schoolId)).toEqual([]);
	});

	test("ledger: the member join fills id and name from members-list by key; pending stays the Worker's []", async () => {
		const { reader, http } = adapters({ worker: "fetch" });
		const entry = (member: { key: string } | null) => ({
			event: { id: "01J" },
			pending: false,
			localTime: "2026-11-06T10:00",
			member,
			credits: null,
			amountCents: 3250,
			paymentId: "pi_1",
			promo: null,
		});
		const page = {
			school: schoolId,
			from: "2026-11-01",
			to: "2026-11-07",
			timeZone: null,
			currency: null,
			unit: null,
			count: 2,
			pending: [],
			days: [
				{
					date: "2026-11-06",
					count: 2,
					credits: 0,
					amountCents: 3250,
					entries: [entry({ key: `family:${familyId}` }), entry(null)],
				},
			],
		} as unknown as WorkerLedgerPage;
		http.on("GET", workerPath(`/schools/${schoolId}/ledger`), {
			status: 200,
			body: envelope(page),
		});
		http.on(
			"GET",
			/members-list$/,
			{ status: 200, body: membersAnswer([memberRow()], "p2") },
			{ status: 200, body: membersAnswer([]) },
		);
		const result = await reader.ledger({
			school: schoolId,
			from: "2026-11-01",
			to: "2026-11-07",
			type: "payment",
			drill: null,
			promo: null,
		});
		expect(result.days[0]?.entries.map(({ member }) => member)).toEqual([
			{ key: `family:${familyId}`, id: profileId, name: "Sam" },
			null,
		]);
		expect(result.pending).toEqual([]);
		expect(result.timeZone).toBeNull();
		expect(workerCalls(http)[0]?.url).toBe(
			`${workerBase}/schools/${schoolId}/ledger?from=2026-11-01&to=2026-11-07&type=payment`,
		);
		expect(
			http.calls
				.filter(({ url }) => url.includes("members-list"))
				.map(({ url }) => new URL(url).search),
		).toEqual(["?limit=100", "?cursor=p2&limit=100"]);
	});

	test("ledger by promo is not available without a request", async () => {
		const { reader, http } = adapters({ worker: "fetch" });
		expect(
			(
				await rejection(
					reader.ledger({
						school: schoolId,
						from: "2026-11-01",
						to: "2026-11-07",
						type: null,
						drill: null,
						promo: "c1",
					}),
				)
			).kind,
		).toBe("not_available");
		expect(http.calls).toEqual([]);
	});

	test("schools: lag and stale from GET /v1/schools, facts from ledger/school; the badges are null, never 0", async () => {
		const { reader, http } = adapters({ worker: "fetch" });
		http.always("GET", /ledger\/school$/, {
			status: 200,
			body: schoolFactsAnswer,
		});
		http.on("GET", workerPath("/schools"), {
			status: 200,
			body: envelope({
				schools: [
					{
						id: schoolId,
						asOf: "2026-11-07T12:00:00Z",
						lagMinutes: 3,
						stale: false,
					},
				],
			}),
		});
		expect(await reader.schools()).toEqual([
			{
				id: schoolId,
				name: "Vibes of Light",
				timeZone: "America/Denver",
				currency: "usd",
				role: "owner",
				creditUnit: { one: "session", other: "sessions" },
				stale: false,
				lagMinutes: 3,
				attentionCount: null,
				tabBadges: null,
			},
		]);
	});

	test("schools: a null lag or school fact is not available, never a made-up value", async () => {
		const { reader, http } = adapters({ worker: "fetch" });
		http.always("GET", /ledger\/school$/, {
			status: 200,
			body: { ...schoolFactsAnswer, timeZone: null },
		});
		http.on("GET", workerPath("/schools"), {
			status: 200,
			body: envelope({
				schools: [{ id: schoolId, asOf: null, lagMinutes: null, stale: true }],
			}),
		});
		const error = await rejection(reader.schools());
		expect(error.kind).toBe("not_available");
		expect(error.message).toContain(`${schoolId}.timeZone`);
		expect(error.message).toContain(`${schoolId}.lagMinutes`);
	});

	test("disclosure without its views and copy is not available; never an invented view", async () => {
		const { reader, http } = adapters({ worker: "fetch" });
		http.on("GET", workerPath(`/schools/${schoolId}/disclosure`), {
			status: 200,
			body: envelope({
				school: schoolId,
				year: 2026,
				size: "small",
				file: {},
				override: null,
				source: "defaults",
			}),
		});
		expect((await rejection(reader.disclosure(schoolId))).kind).toBe(
			"not_available",
		);
	});

	test("disclosure from a Worker that sends views but no View as rows is not available", async () => {
		const { reader, http } = adapters({ worker: "fetch" });
		const views = Object.fromEntries(
			audiences.map((audience) => [audience, { name: audience }]),
		);
		http.on("GET", workerPath(`/schools/${schoolId}/disclosure`), {
			status: 200,
			body: envelope({
				school: schoolId,
				year: 2026,
				size: "small",
				file: {},
				override: null,
				source: "defaults",
				views,
			}),
		});
		const error = await rejection(reader.disclosure(schoolId));
		expect(error.kind).toBe("not_available");
		expect(error.message).toContain("View as rows");
	});
});

describe("the disclosure's viewer and View as rows", () => {
	const copy = Object.fromEntries(
		viewAsValues.map((value) => [
			value,
			{ name: value, summary: `${value} summary`, locks: {} },
		]),
	) as never;

	test("an admin without the finance grant is capped at public, so View as offers nothing the Worker refuses", () => {
		const viewer = viewerOf(profileId, {
			id: schoolId,
			role: "admin",
			finance: false,
		});
		expect(viewer).toMatchObject({
			role: "admin",
			financeGrant: false,
			audience: "public",
			audiences: ["public"],
			viewAs: "admin",
		});
		const rows = viewAsOf(viewer, copy);
		expect(rows.filter(({ held }) => held).map(({ value }) => value)).toEqual([
			"admin",
			"public",
		]);
		expect(rows.find(({ value }) => value === "admin")?.audience).toBe(
			"public",
		);
	});

	test("a finance admin and an owner hold what audiencesOf gives them", () => {
		const finance = viewerOf(profileId, {
			id: schoolId,
			role: "admin",
			finance: true,
		});
		expect(finance.audiences).toEqual([
			"public",
			"member",
			"governance",
			"finance",
		]);
		expect(
			viewAsOf(finance, copy)
				.filter(({ held }) => !held)
				.map(({ value }) => value),
		).toEqual(["owner"]);
		expect(
			viewAsOf(finance, copy).find(({ value }) => value === "admin")?.audience,
		).toBe("member");
		const owner = viewerOf(profileId, {
			id: schoolId,
			role: "owner",
			finance: true,
		});
		expect(owner.audiences).toEqual([...audiences]);
		expect(owner.viewAs).toBe("owner");
	});

	test("assembly keeps the Worker's file, size, year and View as copy; no stored override is the defaults; no name", () => {
		const viewer = viewerOf(profileId, {
			id: schoolId,
			role: "owner",
			finance: true,
		});
		const views = Object.fromEntries(
			audiences.map((audience) => [audience, { name: audience }]),
		) as never;
		const file = { version: 1 } as unknown as DisclosureFile;
		const result: Disclosure = assembleDisclosure(
			{
				school: schoolId,
				year: 2026,
				size: "large",
				file,
				override: null,
				source: "defaults",
				views,
				viewAs: copy,
			},
			viewer,
		);
		expect(result).toMatchObject({
			school: schoolId,
			year: 2026,
			size: "large",
			file,
			override: {},
			views,
		});
		// no route gives the signed-in person's name
		expect(result.viewer.name).toBeNull();
		expect(result.viewAs.map(({ value }) => value)).toEqual([...viewAsValues]);
		expect(
			result.viewAs.map(({ value, name, summary }) => [value, name, summary]),
		).toEqual(viewAsValues.map((value) => [value, value, `${value} summary`]));
	});
});
