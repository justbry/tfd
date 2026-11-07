import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mountApp } from "../../src/app/mount.tsx";
import {
	type Audience,
	audiences,
	type ViewAs,
	viewAsValues,
} from "../../src/data/disclosure.ts";
import type { IncomeStatement, LedgerPage } from "../../src/data/ledger.ts";
import disclosureFixture from "../../src/fixtures/disclosure.json";
import { createFixtureWriter } from "../../src/fixtures/writer.ts";
import {
	type DisclosurePresentationSource,
	viewerOf,
} from "../../src/http/disclosure.ts";
import { AdapterError } from "../../src/http/errors.ts";
import type { LedgerSchoolClaim } from "../../src/http/ledger-token.ts";
import { localWallTime } from "../../src/http/school-routes.ts";
import {
	harness,
	harnessTimeoutMilliseconds,
	httpAdaptersOn,
	type LedgerHarness,
	memberNameOf,
	rawGet,
} from "./worker-harness.ts";

/**
 * S8e part 2, end to end: part 1's HTTP Reader with the real fetch WorkerSource against the real ledger Worker (S8c's
 * harness on Miniflare), every Worker read the Reader makes, and the gating section 11 names. Each answer the Reader
 * gives is compared with the Worker's own answer to a raw GET, so a figure the adapter changed, dropped or filled in
 * shows; a `null` must come through as `null`, never 0.
 */

const owned = "monthly-members";
const financeAdmin = "disputes";
const noFinance = "free-only";
const ownerGrants: LedgerSchoolClaim[] = [
	{ id: owned, role: "owner", finance: true },
	{ id: financeAdmin, role: "admin", finance: true },
	{ id: noFinance, role: "admin", finance: false },
];
const fixtureFile = disclosureFixture.file;
const disclosureCopy = disclosureFixture.schools.b4u;

let worker: LedgerHarness;
const skip = typeof harness === "string";

beforeAll(async () => {
	if (typeof harness === "string") return;
	worker = await harness.startLedgerWorker({
		presets: [owned, financeAdmin, noFinance],
	});
}, harnessTimeoutMilliseconds);
afterAll(async () => {
	await worker?.stop();
});

const rejection = async (promise: Promise<unknown>): Promise<AdapterError> => {
	try {
		await promise;
	} catch (error) {
		if (error instanceof AdapterError) return error;
		throw error;
	}
	throw new Error("expected a rejection");
};
const dataOf = async (path: string, grants = ownerGrants) => {
	const answer = await rawGet(worker, grants, path);
	expect({ path, status: answer.status }).toEqual({ path, status: 200 });
	return answer.body.data;
};
/** The last whole month the seeded logs cover, and the one before it. */
const month = { from: "2026-11-01", to: "2026-11-30" };
const week = { from: "2026-11-01", to: "2026-11-07" };

describe.skipIf(skip)("the HTTP Reader on the real ledger Worker", () => {
	test("schools(): each school of the token, stale and lag from GET /v1/schools, facts from ledger/school", async () => {
		const { reader } = httpAdaptersOn(worker, ownerGrants);
		const schools = await reader.schools();
		const status = (await dataOf("/schools")) as {
			schools: Array<{ id: string; lagMinutes: number; stale: boolean }>;
		};
		expect(schools.map(({ id }) => id)).toEqual(
			ownerGrants.map(({ id }) => id),
		);
		for (const school of schools) {
			const row = status.schools.find(({ id }) => id === school.id);
			expect({
				id: school.id,
				stale: school.stale,
				lagMinutes: school.lagMinutes,
			}).toEqual({
				id: school.id,
				stale: row?.stale as boolean,
				lagMinutes: row?.lagMinutes as number,
			});
			expect(school.attentionCount).toBeNull();
			expect(school.tabBadges).toBeNull();
		}
		expect(schools.find(({ id }) => id === noFinance)?.role).toBe("admin");
	});

	test("kpiDocument for every audience the token allows equals the Worker's; every finer one is audience_not_allowed", async () => {
		const { reader } = httpAdaptersOn(worker, ownerGrants);
		for (const claim of ownerGrants) {
			const allowed = viewerOf("profile", claim).audiences;
			for (const audience of audiences)
				for (const pinLocked of [false, true]) {
					const query = {
						school: claim.id,
						preset: "",
						audience,
						pinLocked,
					};
					if (!allowed.includes(audience)) {
						const error = await rejection(reader.kpiDocument(query));
						expect({ ...query, code: error.detail.code }).toEqual({
							...query,
							code: "audience_not_allowed",
						});
						continue;
					}
					const document = await reader.kpiDocument(query);
					const raw = await dataOf(
						`/schools/${claim.id}/kpi?audience=${audience}&pin=${pinLocked ? "locked" : "open"}`,
					);
					expect({ ...query, document }).toEqual({
						...query,
						document: raw as never,
					});
					expect(document?.audience).toBe(audience);
					expect(document?.source).toEqual({ kind: "events" });
					// The PIN locks the books from governance up; below it `locked` means nothing.
					expect(document?.pinLocked).toBe(
						pinLocked &&
							audiences.indexOf(audience) >= audiences.indexOf("governance"),
					);
				}
		}
	});

	test("disclosure: the Worker's file and views, the viewer from the token; without the View as copy it is not available", async () => {
		const bare = httpAdaptersOn(worker, ownerGrants);
		expect((await rejection(bare.reader.disclosure(owned))).kind).toBe(
			"not_available",
		);
		// The View as copy and the viewer's name have no source yet: the fixture's stand in, as a presentation source.
		const presentation: DisclosurePresentationSource = {
			presentation: async () => ({
				viewerName: "Jo A.",
				rows: Object.fromEntries(
					disclosureCopy.viewAs.map(({ value, name, summary, locks }) => [
						value,
						{ name, summary, locks },
					]),
				) as never,
			}),
		};
		const { reader } = httpAdaptersOn(worker, ownerGrants, { presentation });
		const raw = (await dataOf(`/schools/${owned}/disclosure`)) as Record<
			string,
			unknown
		>;
		const disclosure = await reader.disclosure(owned);
		expect(disclosure.views).toEqual(raw.views as never);
		expect(Object.keys(disclosure.views).sort()).toEqual([...audiences].sort());
		// The Worker ships the same B4 Uni file the UI's fixtures carry.
		expect(disclosure.file).toEqual(fixtureFile as never);
		expect(raw.file).toEqual(fixtureFile);
		expect({ year: disclosure.year, size: disclosure.size }).toEqual({
			year: raw.year as number,
			size: raw.size as never,
		});
		expect(disclosure.override).toEqual({});
		expect(disclosure.viewer).toMatchObject({
			id: "profile_e2e",
			name: "Jo A.",
			role: "owner",
			viewAs: "owner",
			audiences: [...audiences],
		});
		expect(disclosure.viewAs.map(({ value }) => value)).toEqual([
			...viewAsValues,
		] as ViewAs[]);
		const admin = await reader.disclosure(noFinance);
		expect(admin.viewer).toMatchObject({
			audience: "public",
			audiences: ["public"],
		});
	});

	test("audienceReport for public, member and governance equals the Worker's; a finance:false admin gets public only", async () => {
		const { reader } = httpAdaptersOn(worker, ownerGrants);
		for (const audience of ["public", "member", "governance"] as const) {
			const query = { school: owned, audience, ...month };
			const report = await reader.audienceReport(query);
			const raw = await dataOf(
				`/schools/${owned}/audience-report?audience=${audience}&from=${month.from}&to=${month.to}`,
			);
			expect({ audience, report }).toEqual({ audience, report: raw as never });
		}
		expect(
			(
				await reader.audienceReport({
					school: noFinance,
					audience: "public",
					...month,
				})
			).audience,
		).toBe("public");
		const error = await rejection(
			reader.audienceReport({
				school: noFinance,
				audience: "member",
				...month,
			}),
		);
		expect(error.detail.code).toBe("audience_not_allowed");
	});

	test("ledger: the Worker's page with each member's id and name joined from members-list; pending stays []", async () => {
		const { reader } = httpAdaptersOn(worker, ownerGrants);
		const page: LedgerPage = await reader.ledger({
			school: owned,
			...week,
			type: null,
			drill: null,
			promo: null,
		});
		const raw = (await dataOf(
			`/schools/${owned}/ledger?from=${week.from}&to=${week.to}`,
		)) as LedgerPage;
		expect(page.count).toBe(raw.count);
		expect(page.count).toBeGreaterThan(0);
		expect(page.pending).toEqual([]);
		expect({
			timeZone: page.timeZone,
			currency: page.currency,
			unit: page.unit,
		}).toEqual({
			timeZone: raw.timeZone,
			currency: raw.currency,
			unit: raw.unit,
		});
		const entries = page.days.flatMap(({ entries }) => entries);
		const rawEntries = raw.days.flatMap(({ entries }) => entries);
		expect(entries.map(({ event }) => event.id)).toEqual(
			rawEntries.map(({ event }) => event.id),
		);
		const members = entries.flatMap(({ member }) => (member ? [member] : []));
		expect(members.length).toBeGreaterThan(0);
		for (const member of members)
			expect(member).toEqual({
				key: member.key,
				id: `profile-${member.key.slice("family:".length)}`,
				name: memberNameOf(member.key),
			});
		// Each figure is the Worker's: a null stays null.
		expect(
			entries.map(({ credits, amountCents, paymentId }) => ({
				credits,
				amountCents,
				paymentId,
			})),
		).toEqual(
			rawEntries.map(({ credits, amountCents, paymentId }) => ({
				credits,
				amountCents,
				paymentId,
			})),
		);
		const payments = await reader.ledger({
			school: owned,
			...month,
			type: "payment",
			drill: null,
			promo: null,
		});
		expect(
			payments.days
				.flatMap(({ entries }) => entries)
				.every(({ event }) => event.event_type.startsWith("payment.")),
		).toBe(true);
	});

	test("incomeStatement with and without compare: the Worker's statement; its null figures stay null", async () => {
		const { reader } = httpAdaptersOn(worker, ownerGrants);
		for (const compare of [false, true]) {
			const statement: IncomeStatement = await reader.incomeStatement({
				school: owned,
				...month,
				compare,
			});
			const raw = await dataOf(
				`/schools/${owned}/income-statement?from=${month.from}&to=${month.to}&compare=${compare ? 1 : 0}`,
			);
			expect({ compare, statement }).toEqual({
				compare,
				statement: raw as never,
			});
			expect(statement.previous === null).toBe(!compare);
			if (compare) expect(statement.previous?.changes).toBeDefined();
			expect({
				discounts: statement.amounts.discounts,
				giftsSold: statement.amounts.giftsSold,
				giftsOutstanding: statement.giftsOutstanding,
				matchesStripe: statement.matchesStripe,
			}).toEqual({
				discounts: null,
				giftsSold: null,
				giftsOutstanding: null,
				matchesStripe: null,
			});
		}
	});

	test("membersIncome is the Worker's cents", async () => {
		const { reader } = httpAdaptersOn(worker, ownerGrants);
		const cents = await reader.membersIncome({ schoolId: owned, ...month });
		const raw = (await dataOf(
			`/schools/${owned}/members-income?from=${month.from}&to=${month.to}`,
		)) as { cents: number };
		expect(cents).toBe(raw.cents);
		expect(typeof cents).toBe("number");
	});

	test("member money: a member's payments and history from the Worker; an unknown key is not_found", async () => {
		const { worker: source } = httpAdaptersOn(worker, ownerGrants);
		const key = worker.seeded[owned]?.events.find(
			({ event_type, key }) =>
				event_type === "payment.succeeded" && key.startsWith("family:"),
		)?.key as string;
		const money = await source.memberMoney({ school: owned, key });
		const raw = await dataOf(
			`/schools/${owned}/members/${encodeURIComponent(key)}/money`,
		);
		expect(money.data).toEqual(raw as never);
		expect(money.data.payments.length).toBeGreaterThan(0);
		expect(money.data.history.length).toBeGreaterThan(0);
		for (const row of money.data.payments)
			expect([
				"Paid",
				"Open",
				"Refunded",
				"Partly refunded",
				"Failed",
			]).toContain(row.status);
		const error = await rejection(
			source.memberMoney({ school: owned, key: "family:nobody" }),
		);
		expect({ kind: error.kind, code: error.detail.code }).toEqual({
			kind: "not_found",
			code: "not_found",
		});
	});
});

describe.skipIf(skip)("the UI on the Worker's answers", () => {
	test("the Reports statement shows the Worker's null figures as not available, never as $0.00; donors are not available", async () => {
		const { reader } = httpAdaptersOn(worker, ownerGrants, {
			presentation: {
				presentation: async () => ({
					viewerName: "Jo A.",
					rows: Object.fromEntries(
						disclosureCopy.viewAs.map(({ value, name, summary, locks }) => [
							value,
							{ name, summary, locks },
						]),
					) as never,
				}),
			},
		});
		const now = localWallTime(
			Date.parse(worker.clock.now()) / 1000,
			"America/Denver",
		);
		window.location.hash = `#/${owned}/reports?month=2026-11`;
		const root = document.createElement("div");
		root.id = "app";
		document.body.appendChild(root);
		const app = mountApp(root, {
			reader,
			writer: createFixtureWriter({ mode: "instant" }),
			clock: { today: now.slice(0, 10), now },
		});
		const line = (name: string) =>
			root.querySelector(`[data-test=report-line][data-line=${name}]`);
		try {
			for (let attempt = 0; attempt < 400 && !line("discounts"); attempt += 1)
				await new Promise((resolve) => setTimeout(resolve, 0));
			expect(
				line("discounts")
					?.querySelector("[data-test=report-line-amount]")
					?.textContent?.trim(),
			).toBe("—");
			expect(line("gifts")?.textContent?.replace(/\s+/g, " ").trim()).toBe(
				"Not income: gift certificates sold: not available yet",
			);
			expect(
				root.querySelector("[data-test=report-stripe-unchecked]")?.textContent,
			).toBe("Not checked against Stripe yet.");
			// Donors have no source: the card says so, and the statement still shows.
			expect(
				root.querySelector("[data-test=donors-not-available]")?.textContent,
			).toBe("Not available yet: no source records donors.");
		} finally {
			app.unmount();
			root.remove();
			window.location.hash = "";
		}
	});
});

describe.skipIf(skip)("the gating section 11 names, through the Reader", () => {
	test("a finance:false school gets no ledger, statement or member money: finance_required, and no data", async () => {
		const { reader, worker: source } = httpAdaptersOn(worker, ownerGrants);
		const refusals: Array<() => Promise<unknown>> = [
			() =>
				reader.ledger({
					school: noFinance,
					...week,
					type: null,
					drill: null,
					promo: null,
				}),
			() =>
				reader.incomeStatement({ school: noFinance, ...month, compare: false }),
			() => reader.membersIncome({ schoolId: noFinance, ...month }),
			() =>
				source.memberMoney({
					school: noFinance,
					key: worker.seeded[noFinance]?.events.find(({ key }) =>
						key.startsWith("family:"),
					)?.key as string,
				}),
		];
		for (const refused of refusals) {
			const error = await rejection(refused());
			expect({
				kind: error.kind,
				status: error.detail.status,
				code: error.detail.code,
			}).toEqual({
				kind: "forbidden",
				status: 403,
				code: "finance_required",
			});
		}
	});

	test("a school not in the token, or unknown, is a 404 not_found", async () => {
		const { reader } = httpAdaptersOn(worker, [
			ownerGrants[0] as LedgerSchoolClaim,
		]);
		for (const school of [financeAdmin, "no-such-school"]) {
			const error = await rejection(
				reader.kpiDocument({
					school,
					preset: "",
					audience: "public",
					pinLocked: false,
				}),
			);
			expect({ school, kind: error.kind, status: error.detail.status }).toEqual(
				{
					school,
					kind: "not_found",
					status: 404,
				},
			);
		}
	});

	test("an expired token is a 401 token_expired: the token source mints a new one and the read goes through", async () => {
		const lifetime = 60;
		const { reader, buzzSchool } = httpAdaptersOn(worker, ownerGrants, {
			tokenLifetimeSeconds: lifetime,
		});
		const started = worker.clock.now();
		try {
			const first = await reader.membersIncome({ schoolId: owned, ...month });
			expect(buzzSchool.minted).toHaveLength(1);
			const expired = buzzSchool.minted[0] as string;
			worker.clock.advance((lifetime + 30) * 1000);
			const raw = await Bun.fetch(
				`${worker.url}/v1/schools/${owned}/members-income?from=${month.from}&to=${month.to}`,
				{ headers: { authorization: `Bearer ${expired}` } },
			);
			expect(raw.status).toBe(401);
			expect(
				((await raw.json()) as { error: { code: string } }).error.code,
			).toBe("token_expired");
			// The source still holds the expired token (its refresh timer is the scheduler's): the Worker refuses it once.
			expect(await reader.membersIncome({ schoolId: owned, ...month })).toBe(
				first,
			);
			expect(buzzSchool.minted).toHaveLength(2);
			expect(
				buzzSchool.workerCalls.filter((path) =>
					path.includes("/members-income"),
				),
			).toHaveLength(3);
		} finally {
			worker.clock.set(started);
		}
	});

	test("no audience's document holds a family key or a profile id (C5 on the Worker's member-facing documents)", async () => {
		const { reader } = httpAdaptersOn(worker, ownerGrants);
		const keys = [
			...new Set(
				(worker.seeded[owned]?.events ?? [])
					.map(({ key }) => key)
					.filter((key) => key.startsWith("family:")),
			),
		];
		expect(keys.length).toBeGreaterThan(0);
		for (const audience of ["public", "member", "governance"] as Audience[]) {
			const text = JSON.stringify(
				await reader.kpiDocument({
					school: owned,
					preset: "",
					audience,
					pinLocked: false,
				}),
			);
			expect({ audience, family: /family:|profile:/.test(text) }).toEqual({
				audience,
				family: false,
			});
		}
	});
});
