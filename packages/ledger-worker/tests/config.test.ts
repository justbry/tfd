/** The config routes (S9 plan section 4): read, verify and put, their gates, the audit line and the manifest. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { R2BindingStore } from "tfd/worker";
import { canonicalJson } from "../src/config/canonical.js";
import { auditKey, configKey, readStored } from "../src/config/store.js";
import {
	type BookingRulesConfig,
	CONFIG_NAMES,
	type ConfigManifest,
} from "../src/config/types.js";
import {
	type LedgerHarness,
	startLedgerWorker,
} from "../src/testing/harness.js";
import {
	fixtureObjects,
	seedSchoolFixtures,
} from "../src/testing/seed-config.js";
import { call, type Reply } from "./support.js";

const SCHOOL = "vol";
const FRESH_SCHOOL = "fresh";
const BASE = `/v1/schools/${SCHOOL}/config`;
const SECONDS_PER_MINUTE = 60;
const EXPIRED_AFTER_SECONDS = 601;

let harness: LedgerHarness;
let store: R2BindingStore;
beforeAll(async () => {
	harness = await startLedgerWorker({
		presets: ["free-only"],
		schools: [SCHOOL],
	});
	store = new R2BindingStore(harness.bucket);
	await seedSchoolFixtures(store, {
		schools: [SCHOOL],
		now: harness.clock.now(),
	});
}, 120_000);
afterAll(async () => {
	await harness.stop();
});

const nowSeconds = () => Math.floor(Date.parse(harness.clock.now()) / 1000);
const sha256 = (text: string) =>
	createHash("sha256").update(text).digest("hex");

type Grant = { role: string; finance: boolean };
const OWNER: Grant = { role: "owner", finance: true };
const ADMIN: Grant = { role: "admin", finance: false };

const tokenFor = (
	grant: Grant,
	options: { stepUpAt?: number | null; school?: string; sub?: string } = {},
) =>
	harness.mintToken({
		sub: options.sub ?? "profile_secret_1",
		schools: [{ id: options.school ?? SCHOOL, ...grant }],
		...(options.stepUpAt === null
			? {}
			: { stepUpAt: options.stepUpAt ?? nowSeconds() }),
	});

const json = (
	token: string,
	method: string,
	path: string,
	body: unknown,
	headers: Record<string, string> = {},
) =>
	call(harness, token, path, {
		method,
		body: JSON.stringify(body),
		headers: { "content-type": "application/json", ...headers },
	});

const current = async (name: string, school = SCHOOL) => {
	const stored = await readStored(store, configKey(school, name as never));
	if (stored === null) throw new Error(`${name} is not seeded`);
	return stored;
};

const auditLines = async (
	school = SCHOOL,
): Promise<Record<string, unknown>[]> => {
	const month = harness.clock.now().slice(0, 7);
	const stored = await readStored(store, auditKey(school, month));
	return stored === null
		? []
		: stored.text
				.split("\n")
				.filter((line) => line !== "")
				.map((line) => JSON.parse(line) as Record<string, unknown>);
};

const rules = (over: Partial<BookingRulesConfig> = {}): BookingRulesConfig => ({
	schemaVersion: 1,
	cancelCutoffHours: 36,
	noShow: "release",
	lateCancel: "spend",
	...over,
});

const expectError = (reply: Reply, status: number, code: string) => {
	expect(reply.status).toBe(status);
	expect(reply.body.error?.code).toBe(code);
	expect(reply.headers.get("cache-control")).toBe("private, no-store");
};

/** A verified put of `value` over the object's current ETag. */
const verifiedPut = async (name: string, value: unknown, token: string) => {
	const verify = await json(token, "POST", `${BASE}/${name}/verify`, { value });
	const data = verify.body.data as { verifiedHash: string; baseEtag: string };
	return json(
		token,
		"PUT",
		`${BASE}/${name}`,
		{ value, verifiedHash: data.verifiedHash },
		{ "if-match": `"${data.baseEtag}"` },
	);
};

describe("read", () => {
	test("serves the object in the envelope with its sha256 as the ETag", async () => {
		const reply = await call(
			harness,
			await tokenFor(ADMIN),
			`${BASE}/settings`,
		);
		expect(reply.status).toBe(200);
		const stored = await current("settings");
		expect(reply.headers.get("etag")).toBe(`"${stored.sha256}"`);
		expect(stored.sha256).toBe(sha256(stored.text));
		expect(reply.body.data).toEqual(
			fixtureObjects(SCHOOL, "vol").settings as never,
		);
		expect(reply.body.asOf).toBe(harness.seeded[SCHOOL]?.asOf as string);
		expect(typeof reply.body.lagMinutes).toBe("number");
		expect(reply.headers.get("cache-control")).toBe("private, no-store");
	});

	test("a school with no views yet still serves its config, with null freshness", async () => {
		const owner = await tokenFor(OWNER, { school: FRESH_SCHOOL });
		const put = await json(
			owner,
			"PUT",
			`/v1/schools/${FRESH_SCHOOL}/config/booking-rules`,
			{ value: rules(), verifiedHash: sha256(canonicalJson(rules())) },
			{ "if-none-match": "*" },
		);
		expect(put.status).toBe(200);
		const reply = await call(
			harness,
			owner,
			`/v1/schools/${FRESH_SCHOOL}/config/booking-rules`,
		);
		expect(reply.status).toBe(200);
		expect(reply.body.asOf).toBeNull();
		expect(reply.body.lagMinutes).toBeNull();
	});

	test("an unwritten object is not_found, an unknown name too, and so is a school outside the token", async () => {
		const admin = await tokenFor(ADMIN);
		expectError(
			await call(harness, admin, `/v1/schools/${FRESH_SCHOOL}/config/x`),
			404,
			"not_found",
		);
		expectError(await call(harness, admin, `${BASE}/nope`), 404, "not_found");
		expectError(
			await call(harness, admin, `${BASE}/constructor`),
			404,
			"not_found",
		);
		expectError(
			await call(harness, admin, `/v1/schools/other/config/settings`),
			404,
			"not_found",
		);
	});

	test("every object of the seeded school reads, the manifest included", async () => {
		const owner = await tokenFor(OWNER);
		for (const name of [...CONFIG_NAMES, "manifest"])
			expect((await call(harness, owner, `${BASE}/${name}`)).status).toBe(200);
	});

	test("money-bearing objects need the finance grant, even for the owner", async () => {
		expectError(
			await call(harness, await tokenFor(ADMIN), `${BASE}/promos`),
			403,
			"finance_required",
		);
		expectError(
			await call(
				harness,
				await tokenFor({ role: "owner", finance: false }),
				`${BASE}/promos`,
			),
			403,
			"finance_required",
		);
		const financeAdmin = await tokenFor({ role: "admin", finance: true });
		const reply = await call(harness, financeAdmin, `${BASE}/promos`);
		expect(reply.status).toBe(200);
		expect(reply.body.data).toEqual(
			fixtureObjects(SCHOOL, "vol").promos as never,
		);
	});

	test("a request without a token is a 401", async () => {
		expectError(
			await call(harness, null, `${BASE}/settings`),
			401,
			"token_missing",
		);
	});
});

describe("verify", () => {
	test("an acceptable value answers ok, the diff, the hash of its canonical text and the base ETag, and writes nothing", async () => {
		const before = await current("booking-rules");
		const manifestBefore = await current("manifest");
		const linesBefore = (await auditLines()).length;
		const value = {
			...(JSON.parse(before.text) as BookingRulesConfig),
			cancelCutoffHours: 48,
		};
		const reply = await json(
			await tokenFor(OWNER, { stepUpAt: null }),
			"POST",
			`${BASE}/booking-rules/verify`,
			{ value },
		);
		expect(reply.status).toBe(200);
		expect(reply.body.data).toEqual({
			ok: true,
			problems: [],
			diff: [
				{ path: "cancelCutoffHours", change: "changed", before: 24, after: 48 },
			],
			verifiedHash: sha256(canonicalJson(value)),
			baseEtag: before.sha256,
		} as never);
		expect((await current("booking-rules")).text).toBe(before.text);
		expect((await current("manifest")).text).toBe(manifestBefore.text);
		expect((await auditLines()).length).toBe(linesBefore);
	});

	test("an invalid value answers ok:false with every problem, and no hash", async () => {
		const reply = await json(
			await tokenFor(OWNER),
			"POST",
			`${BASE}/booking-rules/verify`,
			{
				value: {
					schemaVersion: 1,
					cancelCutoffHours: -1,
					noShow: "keep",
					extra: true,
				},
			},
		);
		expect(reply.status).toBe(200);
		const data = reply.body.data as {
			ok: boolean;
			problems: { path: string; message: string; hint: string }[];
			verifiedHash: string | null;
			diff: unknown[];
		};
		expect(data.ok).toBe(false);
		expect(data.verifiedHash).toBeNull();
		expect(data.diff).toEqual([]);
		expect(data.problems.map((problem) => problem.path).sort()).toEqual([
			"cancelCutoffHours",
			"extra",
			"lateCancel",
			"noShow",
		]);
		for (const problem of data.problems) {
			expect(problem.message).not.toBe("");
			expect(problem.hint).not.toBe("");
		}
	});

	test("only the owner verifies, and a body without a value is a bad request", async () => {
		expectError(
			await json(
				await tokenFor(ADMIN),
				"POST",
				`${BASE}/booking-rules/verify`,
				{ value: rules() },
			),
			403,
			"owner_only",
		);
		const owner = await tokenFor(OWNER);
		const reply = await json(owner, "POST", `${BASE}/booking-rules/verify`, {});
		expectError(reply, 400, "bad_request");
		expect(reply.body.error?.field).toBe("value");
		const notJson = await call(harness, owner, `${BASE}/booking-rules/verify`, {
			method: "POST",
			body: "{",
		});
		expectError(notJson, 400, "bad_request");
	});

	test("the manifest and the wrong method are refused", async () => {
		const owner = await tokenFor(OWNER);
		expectError(
			await json(owner, "POST", `${BASE}/manifest/verify`, { value: {} }),
			405,
			"method_not_allowed",
		);
		expectError(
			await call(harness, owner, `${BASE}/settings/verify`),
			405,
			"method_not_allowed",
		);
		expectError(
			await json(owner, "POST", `${BASE}/settings`, { value: {} }),
			405,
			"method_not_allowed",
		);
		expectError(
			await json(owner, "DELETE", `${BASE}/settings`, {}),
			405,
			"method_not_allowed",
		);
	});

	test("a money-bearing object needs the finance grant to verify as well", async () => {
		expectError(
			await json(
				await tokenFor({ role: "owner", finance: false }),
				"POST",
				`${BASE}/promos/verify`,
				{ value: { schemaVersion: 1, promos: [] } },
			),
			403,
			"finance_required",
		);
	});
});

describe("put", () => {
	test("writes the verified value: ETag, audit line, manifest, and no profile id anywhere", async () => {
		const owner = await tokenFor(OWNER);
		const before = await current("booking-rules");
		const linesBefore = (await auditLines()).length;
		const value = rules({ cancelCutoffHours: 30 });
		const reply = await verifiedPut("booking-rules", value, owner);
		expect(reply.status).toBe(200);
		const text = canonicalJson(value);
		expect(reply.body.data).toEqual({
			name: "booking-rules",
			sha256: sha256(text),
			bytes: new TextEncoder().encode(text).length,
			changed: true,
		} as never);
		expect(reply.headers.get("etag")).toBe(`"${sha256(text)}"`);
		expect((await current("booking-rules")).text).toBe(text);
		const read = await call(harness, owner, `${BASE}/booking-rules`);
		expect(read.body.data).toEqual(value as never);

		const lines = await auditLines();
		expect(lines).toHaveLength(linesBefore + 1);
		const line = lines.at(-1) as Record<string, unknown>;
		expect(line).toMatchObject({
			name: "booking-rules",
			before: before.sha256,
			after: sha256(text),
			at: harness.clock.now(),
		});
		expect(String(line.by)).toMatch(/^u_[0-9a-f]{16}$/);
		const manifest = JSON.parse(
			(await current("manifest")).text,
		) as ConfigManifest;
		expect(manifest.objects["booking-rules"]).toMatchObject({
			sha256: sha256(text),
			updatedBy: line.by,
			updatedAt: harness.clock.now(),
		});
		const stored = [
			(await current("manifest")).text,
			(
				await readStored(
					store,
					auditKey(SCHOOL, harness.clock.now().slice(0, 7)),
				)
			)?.text,
		].join("\n");
		expect(stored).not.toContain("profile_secret_1");
	});

	test("the manifest's hashes and sizes match the stored bytes", async () => {
		const manifest = JSON.parse(
			(await current("manifest")).text,
		) as ConfigManifest;
		expect(Object.keys(manifest.objects).sort()).toEqual(
			[...CONFIG_NAMES].sort(),
		);
		for (const [name, entry] of Object.entries(manifest.objects)) {
			const stored = await current(name);
			expect(entry.sha256).toBe(sha256(stored.text));
			expect(entry.bytes).toBe(new TextEncoder().encode(stored.text).length);
		}
	});

	test("a stale ETag is a 412 stale_etag and changes nothing", async () => {
		const owner = await tokenFor(OWNER);
		const stale = (await current("booking-rules")).sha256;
		expect(
			(
				await verifiedPut(
					"booking-rules",
					rules({ cancelCutoffHours: 20 }),
					owner,
				)
			).status,
		).toBe(200);
		const after = await current("booking-rules");
		const linesBefore = (await auditLines()).length;
		const value = rules({ cancelCutoffHours: 12 });
		const reply = await json(
			owner,
			"PUT",
			`${BASE}/booking-rules`,
			{ value, verifiedHash: sha256(canonicalJson(value)) },
			{ "if-match": `"${stale}"` },
		);
		expectError(reply, 412, "stale_etag");
		expect((await current("booking-rules")).text).toBe(after.text);
		expect((await auditLines()).length).toBe(linesBefore);
	});

	test("an invalid value is a 422 invalid_config with problems[]", async () => {
		const owner = await tokenFor(OWNER);
		const base = await current("booking-rules");
		const value = rules({ noShow: "keep" as never });
		const reply = await json(
			owner,
			"PUT",
			`${BASE}/booking-rules`,
			{ value, verifiedHash: sha256(canonicalJson(value)) },
			{ "if-match": `"${base.sha256}"` },
		);
		expectError(reply, 422, "invalid_config");
		expect(reply.body.error).toMatchObject({
			problems: [{ path: "noShow" }],
		});
		expect((await current("booking-rules")).text).toBe(base.text);
	});

	test("a verifiedHash that is not the hash of the value is refused", async () => {
		const owner = await tokenFor(OWNER);
		const base = await current("booking-rules");
		const linesBefore = (await auditLines()).length;
		const reply = await json(
			owner,
			"PUT",
			`${BASE}/booking-rules`,
			{
				value: rules({ cancelCutoffHours: 5 }),
				verifiedHash: sha256(canonicalJson(rules({ cancelCutoffHours: 6 }))),
			},
			{ "if-match": `"${base.sha256}"` },
		);
		expectError(reply, 422, "invalid_config");
		expect(reply.body.error).toMatchObject({
			problems: [{ path: "verifiedHash" }],
		});
		const missing = await json(
			owner,
			"PUT",
			`${BASE}/booking-rules`,
			{ value: rules({ cancelCutoffHours: 5 }) },
			{ "if-match": `"${base.sha256}"` },
		);
		expectError(missing, 400, "bad_request");
		expect(missing.body.error?.field).toBe("verifiedHash");
		expect((await current("booking-rules")).text).toBe(base.text);
		expect((await auditLines()).length).toBe(linesBefore);
	});

	test("an admin is refused with owner_only, whatever the step-up", async () => {
		const base = await current("booking-rules");
		const value = rules({ cancelCutoffHours: 7 });
		const reply = await json(
			await tokenFor({ role: "admin", finance: true }),
			"PUT",
			`${BASE}/booking-rules`,
			{ value, verifiedHash: sha256(canonicalJson(value)) },
			{ "if-match": `"${base.sha256}"` },
		);
		expectError(reply, 403, "owner_only");
		expect((await current("booking-rules")).text).toBe(base.text);
	});

	test("a token without su, or with an expired or future one, is step_up_required", async () => {
		const base = await current("booking-rules");
		const value = rules({ cancelCutoffHours: 8 });
		const body = { value, verifiedHash: sha256(canonicalJson(value)) };
		const headers = { "if-match": `"${base.sha256}"` };
		const attempt = async (stepUpAt: number | null) =>
			json(
				await tokenFor(OWNER, { stepUpAt }),
				"PUT",
				`${BASE}/booking-rules`,
				body,
				headers,
			);
		expectError(await attempt(null), 403, "step_up_required");
		expectError(
			await attempt(nowSeconds() - EXPIRED_AFTER_SECONDS),
			403,
			"step_up_required",
		);
		expectError(
			await attempt(nowSeconds() + SECONDS_PER_MINUTE),
			403,
			"step_up_required",
		);
		expect((await current("booking-rules")).text).toBe(base.text);
		// the edge: 10 minutes to the second still counts
		const edge = await attempt(nowSeconds() - 10 * SECONDS_PER_MINUTE);
		expect(edge.status).toBe(200);
	});

	test("If-Match is required; a new object takes If-None-Match: *, and only once", async () => {
		const owner = await tokenFor(OWNER, { school: FRESH_SCHOOL });
		const path = `/v1/schools/${FRESH_SCHOOL}/config/booking-rules`;
		const value = rules({ cancelCutoffHours: 72 });
		const body = { value, verifiedHash: sha256(canonicalJson(value)) };
		expectError(await json(owner, "PUT", path, body), 400, "bad_request");
		// the object exists since the read test: `*` no longer fits, nor does a made-up hash
		expectError(
			await json(owner, "PUT", path, body, { "if-none-match": "*" }),
			412,
			"stale_etag",
		);
		expectError(
			await json(owner, "PUT", path, body, {
				"if-match": `"${"0".repeat(64)}"`,
			}),
			412,
			"stale_etag",
		);
		expectError(
			await json(owner, "PUT", path, body, { "if-match": 'W/"abc"' }),
			400,
			"bad_request",
		);
		// an object that does not exist takes no If-Match
		expectError(
			await json(
				owner,
				"PUT",
				`/v1/schools/${FRESH_SCHOOL}/config/settings`,
				{ value: {}, verifiedHash: "0".repeat(64) },
				{ "if-match": `"${"0".repeat(64)}"` },
			),
			422,
			"invalid_config",
		);
	});

	test("a put of what is already stored changes nothing and says so", async () => {
		const owner = await tokenFor(OWNER);
		const base = await current("booking-rules");
		const value = JSON.parse(base.text) as BookingRulesConfig;
		const linesBefore = (await auditLines()).length;
		const reply = await verifiedPut("booking-rules", value, owner);
		expect(reply.status).toBe(200);
		expect((reply.body.data as { changed: boolean }).changed).toBe(false);
		expect((await auditLines()).length).toBe(linesBefore);
		expect((await current("booking-rules")).text).toBe(base.text);
	});

	test("a money-bearing object takes a put only from an owner with the finance grant", async () => {
		const value = { schemaVersion: 1, promos: [] };
		const base = await current("promos");
		const body = { value, verifiedHash: sha256(canonicalJson(value)) };
		expectError(
			await json(
				await tokenFor({ role: "owner", finance: false }),
				"PUT",
				`${BASE}/promos`,
				body,
				{ "if-match": `"${base.sha256}"` },
			),
			403,
			"finance_required",
		);
		const ok = await json(
			await tokenFor(OWNER),
			"PUT",
			`${BASE}/promos`,
			body,
			{ "if-match": `"${base.sha256}"` },
		);
		expect(ok.status).toBe(200);
	});

	test("the bucket keeps one audit line for each accepted write and none for a refused one", async () => {
		const lines = await auditLines();
		const writers = new Set(lines.map((line) => line.by));
		expect(writers.size).toBe(1);
		for (const line of lines) {
			expect(Object.keys(line).sort()).toEqual([
				"after",
				"at",
				"before",
				"by",
				"name",
			]);
			expect(line.after).not.toBe(line.before);
		}
	});
});
