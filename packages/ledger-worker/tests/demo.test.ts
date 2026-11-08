/**
 * Demo schools (`src/demo.ts`): with `LEDGER_DEMO_SCHOOLS=on`, `demo-<preset>` is open to every caller, read-only, and
 * `GET /v1/schools` lists the demo schools after the token's. An invalid token is refused all the same, a real school
 * still needs its token, and with the flag off a demo id is any other unknown school.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { R2BindingStore, readViewsFromStore } from "tfd/worker";
import { runDemoSeed } from "../scripts/seed-demo.js";
import { demoFactsKey, demoNameOf } from "../src/demo.js";
import {
	DEMO_PRESETS,
	demoFactsOf,
	seedDemoSchool,
} from "../src/testing/demo-seed.js";
import {
	type LedgerHarness,
	startLedgerWorker,
} from "../src/testing/harness.js";
import { DEMO_REBUILD_MINUTES, runViewsJob } from "../src/views-job.js";
import { call, type Reply } from "./support.js";

const REAL = "6f1c2d3e-4a5b-4c6d-8e7f-901234567890";
const DEMOS = ["demo-monthly-members", "demo-tiny-school"];
const MS_PER_MINUTE = 60_000;

let harness: LedgerHarness;
let flagOff: LedgerHarness;
beforeAll(async () => {
	[harness, flagOff] = await Promise.all([
		startLedgerWorker({
			presets: ["disputes"],
			schools: [REAL],
			demoPresets: ["monthly-members", "tiny-school"],
		}),
		startLedgerWorker({
			presets: ["disputes"],
			schools: [REAL],
			demoPresets: ["monthly-members", "tiny-school"],
			demoSchools: false,
		}),
	]);
}, 240_000);
afterAll(async () => {
	await Promise.all([harness?.stop(), flagOff?.stop()]);
});

const realToken = (worker: LedgerHarness) =>
	worker.mintToken({
		sub: "profile_real",
		schools: [{ id: REAL, role: "admin", finance: false }],
	});

type Row = {
	id: string;
	demo?: boolean;
	name?: string;
	stale: boolean;
	lagMinutes: number | null;
};
const rowsOf = (reply: Reply): Row[] =>
	(reply.body.data as { schools: Row[] }).schools;
const expectError = (reply: Reply, status: number, code: string) => {
	expect(reply.status).toBe(status);
	expect(reply.body.error?.code).toBe(code);
};

describe("the flag on", () => {
	test("no token: GET /v1/schools lists only the demo schools, each with demo:true and its facts", async () => {
		const reply = await call(harness, null, "/v1/schools");
		expect(reply.status).toBe(200);
		const rows = rowsOf(reply);
		expect(rows.map((row) => row.id)).toEqual(DEMOS);
		expect(rows[0]).toMatchObject({
			id: "demo-monthly-members",
			demo: true,
			name: "Demo · Monthly members",
			timeZone: "America/Denver",
			currency: "USD",
			creditUnit: { one: "class", other: "classes" },
			stale: false,
		});
		expect(typeof rows[0]?.lagMinutes).toBe("number");
	});

	test("a token: its schools as today, then the demo schools", async () => {
		const reply = await call(harness, await realToken(harness), "/v1/schools");
		expect(reply.status).toBe(200);
		const rows = rowsOf(reply);
		expect(rows.map((row) => row.id)).toEqual([REAL, ...DEMOS]);
		expect(rows[0]?.demo).toBeUndefined();
		expect(rows.slice(1).every((row) => row.demo === true)).toBe(true);
	});

	test("no token reads a demo school as its owner with the finance grant", async () => {
		for (const path of [
			"kpi?audience=owner&pin=open",
			"disclosure",
			"ledger?from=2026-03-01&to=2026-03-31",
			"income-statement?from=2026-03-01&to=2026-03-31",
			"members-income?from=2026-03-01&to=2026-03-31",
			"fundraising?from=2026-03-01&to=2026-03-31",
		]) {
			const reply = await call(
				harness,
				null,
				`/v1/schools/demo-monthly-members/${path}`,
			);
			expect({ path, status: reply.status }).toEqual({ path, status: 200 });
			expect(reply.body.asOf).toBe(
				harness.seeded["demo-monthly-members"]?.asOf,
			);
		}
	});

	test("a valid token that does not list the demo school reads it too, at the finance grant", async () => {
		const reply = await call(
			harness,
			await realToken(harness),
			"/v1/schools/demo-tiny-school/ledger?from=2026-03-01&to=2026-03-31",
		);
		expect(reply.status).toBe(200);
		// the token's own school keeps the token's grant: an admin without finance is refused the ledger
		expectError(
			await call(
				harness,
				await realToken(harness),
				`/v1/schools/${REAL}/ledger?from=2026-03-01&to=2026-03-31`,
			),
			403,
			"finance_required",
		);
	});

	test("an invalid or expired token is refused with 401, demo school or not", async () => {
		const expired = await harness.mintToken({
			sub: "profile_real",
			schools: [{ id: REAL, role: "owner", finance: true }],
			expiresInSeconds: -60,
		});
		for (const path of [
			"/v1/schools",
			"/v1/schools/demo-monthly-members/kpi?audience=owner",
		]) {
			expectError(
				await call(harness, "not.a.token", path),
				401,
				"token_invalid",
			);
			expectError(await call(harness, expired, path), 401, "token_expired");
			const malformed = await fetch(`${harness.url}${path}`, {
				headers: { authorization: "Basic abc" },
			});
			expect(malformed.status).toBe(401);
		}
	});

	test("a real school still needs its token: no token is 401, the same as an unknown path", async () => {
		expectError(
			await call(harness, null, `/v1/schools/${REAL}/kpi?audience=public`),
			401,
			"token_missing",
		);
		expectError(
			await call(harness, null, "/v1/schools/demo_monthly/kpi?audience=public"),
			401,
			"token_missing",
		);
		expectError(await call(harness, null, "/v1/nothing"), 401, "token_missing");
	});

	test("a demo school's config reads as any school's and refuses a verify or a put", async () => {
		expectError(
			await call(
				harness,
				null,
				"/v1/schools/demo-monthly-members/config/settings",
			),
			404,
			"not_found",
		);
		const owner = await harness.mintToken({
			sub: "profile_owner",
			schools: [{ id: "demo-monthly-members", role: "owner", finance: true }],
			stepUpAt: Math.floor(Date.parse(harness.clock.now()) / 1000),
		});
		for (const token of [null, owner])
			for (const [method, path] of [
				["PUT", "config/settings"],
				["POST", "config/settings/verify"],
			] as const)
				expectError(
					await call(
						harness,
						token,
						`/v1/schools/demo-monthly-members/${path}`,
						{
							method,
							body: JSON.stringify({ value: {}, verifiedHash: "0".repeat(64) }),
							headers: {
								"content-type": "application/json",
								"if-none-match": "*",
							},
						},
					),
					403,
					"demo_read_only",
				);
	});
});

describe("the flag off", () => {
	test("a demo id is an unknown school, and no token is a 401 everywhere", async () => {
		const token = await flagOff.mintToken({
			sub: "profile_real",
			schools: [{ id: REAL, role: "owner", finance: true }],
		});
		expectError(
			await call(
				flagOff,
				token,
				"/v1/schools/demo-monthly-members/kpi?audience=owner",
			),
			404,
			"not_found",
		);
		expectError(
			await call(
				flagOff,
				null,
				"/v1/schools/demo-monthly-members/kpi?audience=owner",
			),
			401,
			"token_missing",
		);
		expectError(await call(flagOff, null, "/v1/schools"), 401, "token_missing");
		const listed = await call(flagOff, token, "/v1/schools");
		expect(rowsOf(listed).map((row) => row.id)).toEqual([REAL]);
	});
});

describe("the views job and demo schools", () => {
	const manifestAsOf = async (store: R2BindingStore, school: string) => {
		const reader = await readViewsFromStore(store, school);
		return reader.ok ? Date.parse(reader.manifest.asOf) : null;
	};

	test("rebuilds one demo school per run, the oldest, and only once its views are an hour old", async () => {
		const store = new R2BindingStore(flagOff.bucket);
		const before = await Promise.all(
			DEMOS.map((school) => manifestAsOf(store, school)),
		);
		const [older, newer] = [...(before as number[])].sort((a, b) => a - b) as [
			number,
			number,
		];
		const oldestSchool = DEMOS[before.indexOf(older)] ?? (DEMOS[0] as string);
		const soon = new Date(newer + (DEMO_REBUILD_MINUTES - 1) * MS_PER_MINUTE);
		// the older demo is due once the newer is not: only it runs
		const first = await runViewsJob(store, soon);
		const demoRuns = (results: Awaited<ReturnType<typeof runViewsJob>>) =>
			results.filter((result) => result.school.startsWith("demo-"));
		expect(first.map((result) => result.school)).toContain(REAL);
		if (soon.getTime() - older >= DEMO_REBUILD_MINUTES * MS_PER_MINUTE)
			expect(demoRuns(first).map((result) => result.school)).toEqual([
				oldestSchool,
			]);
		else expect(demoRuns(first)).toEqual([]);
		const later = new Date(newer + 2 * DEMO_REBUILD_MINUTES * MS_PER_MINUTE);
		const second = await runViewsJob(store, later);
		expect(demoRuns(second)).toHaveLength(1);
		const third = await runViewsJob(store, later);
		expect(demoRuns(third)).toHaveLength(1);
		expect(demoRuns(third)[0]?.school).not.toBe(demoRuns(second)[0]?.school);
		// both are now fresh: none is due
		expect(demoRuns(await runViewsJob(store, later))).toEqual([]);
	});
});

describe("the demo seed", () => {
	test("the fifteen school presets, named for the switcher", () => {
		expect(DEMO_PRESETS).toHaveLength(15);
		expect(demoNameOf("demo-growth-12mo")).toBe("Demo · Growth over 12 months");
		expect(demoNameOf("demo-single-refund-month")).toBe(
			"Demo · Single refund month",
		);
		expect(demoFactsOf("non-usd").currency).toBe("EUR");
	});

	test("a rerun writes nothing new, removes what the preset no longer makes, and leaves every other prefix alone", async () => {
		const store = new R2BindingStore(harness.bucket);
		const now = new Date(harness.clock.now());
		const again = await seedDemoSchool(store, "tiny-school", {
			now,
			views: false,
		});
		expect(again.written).toBe(0);
		expect(again.removed).toBe(0);
		expect(again.unchanged).toBeGreaterThan(0);
		const stray =
			"schools/demo-tiny-school/events/date=2026-01-01/batch-stray.jsonl";
		await harness.bucket.put(stray, new TextEncoder().encode("{}\n"), {});
		const realKeys = async () =>
			(await store.list({ prefix: `schools/${REAL}/` })).objects.map(
				(object) => `${object.key}:${object.etag}`,
			);
		const realBefore = await realKeys();
		const cleaned = await seedDemoSchool(store, "tiny-school", {
			now,
			views: false,
		});
		expect(cleaned.removed).toBe(1);
		expect(await harness.bucket.head(stray)).toBeNull();
		expect(await realKeys()).toEqual(realBefore);
		const facts = await store.get(demoFactsKey("demo-tiny-school"));
		expect(JSON.parse(new TextDecoder().decode(facts.body))).toEqual(
			demoFactsOf("tiny-school"),
		);
	});

	test("a preset that is not a school preset is refused", async () => {
		await expect(
			seedDemoSchool(new R2BindingStore(harness.bucket), "church-giving", {
				now: new Date(),
			}),
		).rejects.toThrow("not one of the demo school presets");
	});

	test("seed:demo refuses a production bucket, any other bucket and another preset before any store is made", async () => {
		const env = {
			R2_LEDGER_ENDPOINT: "https://example.r2.cloudflarestorage.com",
			R2_LEDGER_BUCKET: "b4uni-stg-ledger",
			R2_LEDGER_ACCESS_KEY_ID: "id",
			R2_LEDGER_SECRET_ACCESS_KEY: "key",
		};
		const refused = async (
			argv: string[],
			overrides: Record<string, string>,
			words: string,
		) => {
			let output = "";
			let stores = 0;
			const code = await runDemoSeed({
				argv,
				env: { ...env, ...overrides },
				now: () => new Date(),
				write: (text) => {
					output += text;
				},
				storeFor: () => {
					stores += 1;
					throw new Error("no store may be made");
				},
			});
			expect(code).toBe(2);
			expect(stores).toBe(0);
			expect(output).toContain(words);
			expect(output).not.toContain("key\n");
		};
		await refused(
			[],
			{ R2_LEDGER_BUCKET: "b4uni-prod-ledger" },
			"staging only",
		);
		await refused(
			[],
			{ R2_LEDGER_BUCKET: "b4uni-stg-other" },
			"only b4uni-stg-ledger",
		);
		await refused(["--preset", "saas-seats"], {}, "the demo schools are");
	});
});
