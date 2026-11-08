/**
 * `Server-Timing` on every `/v1` answer (`timing.ts`): the phases a request went through, by name only. A cold demo
 * `/v1/schools` reads the demo index; a cold stored disclosure reads the manifest, the pointer and the answers after a
 * Cache API miss; the next isolate finds it in the cache, the same isolate in itself; another day computes a fallback.
 * No school id, subject or key appears in the header.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { forgetGenerations } from "../src/data/snapshot.js";
import {
	type AnswersCache,
	forgetStoredAnswers,
} from "../src/routes/stored.js";
import {
	type LedgerHarness,
	startLedgerWorker,
} from "../src/testing/harness.js";
import { r2KindOf } from "../src/timing.js";
import { createLedgerWorker } from "../src/worker.js";

const PRESET = "monthly-members";
const DEMO = "demo-monthly-members";
const SUBJECT = "profile_timing";
const DAY_MS = 86_400_000;
const ENTRY = /^([a-z0-9-]+)(?:;dur=([0-9.]+))?(?:;desc="([^"]*)")?$/;

let harness: LedgerHarness;
let token: string;
beforeAll(async () => {
	harness = await startLedgerWorker({
		presets: [PRESET],
		demoPresets: [PRESET],
	});
	token = await harness.mintToken({
		sub: SUBJECT,
		schools: [{ id: PRESET, role: "owner", finance: true }],
	});
}, 180_000);
afterAll(async () => {
	await harness.stop();
});

type Entry = { dur: number | null; desc: string | null };

/** The header's entries by name; every entry is well formed. */
const entriesOf = (header: string | null): Map<string, Entry> => {
	expect(header).not.toBeNull();
	const entries = new Map<string, Entry>();
	for (const part of (header ?? "").split(", ")) {
		const match = ENTRY.exec(part);
		expect(match, part).not.toBeNull();
		if (match === null) continue;
		entries.set(match[1] as string, {
			dur: match[2] === undefined ? null : Number(match[2]),
			desc: match[3] ?? null,
		});
	}
	return entries;
};

/** Neither school, nor the subject, nor the token is in it. */
const expectNoIds = (header: string | null): void => {
	for (const id of [PRESET, DEMO, SUBJECT, token])
		expect(header ?? "").not.toContain(id);
};

const memoryCache = (): AnswersCache => {
	const entries = new Map<string, string>();
	return {
		match: async (key) => {
			const text = entries.get(key);
			return text === undefined ? undefined : new Response(text);
		},
		put: async (key, response) => {
			entries.set(key, await response.text());
		},
	};
};

/** The Worker in this process over the harness's bucket; `cold` forgets the isolate's generations and answers. */
const inProcess = (cache: AnswersCache, offsetMs = 0) => {
	const worker = createLedgerWorker({
		clock: () => Date.parse(harness.clock.now()) + offsetMs,
		fetchJwks: async () =>
			new Response(JSON.stringify({ keys: harness.jwks.keys() })),
		answersCache: cache,
	});
	return async (path: string, options: { token?: string; cold?: boolean }) => {
		if (options.cold) {
			forgetGenerations();
			forgetStoredAnswers();
		}
		const response = await worker.fetch(
			new Request(`https://ledger.test${path}`, {
				headers:
					options.token === undefined
						? {}
						: { authorization: `Bearer ${options.token}` },
			}),
			{
				LEDGER_BUCKET: harness.bucket,
				LEDGER_ISS: harness.issuer,
				LEDGER_JWKS_URL: "https://jwks.test",
				LEDGER_DEMO_SCHOOLS: "on",
			},
		);
		await response.arrayBuffer();
		return response;
	};
};

test("the R2 keys count under their names", () => {
	expect(r2KindOf(`schools/${DEMO}/views/manifest.json`)).toBe("r2-manifest");
	expect(r2KindOf(`schools/${DEMO}/views/answers/current.json`)).toBe(
		"r2-pointer",
	);
	expect(r2KindOf(`schools/${DEMO}/views/answers/answers.jsonl`)).toBe(
		"r2-answers",
	);
	expect(r2KindOf("schools/_demo-index.json")).toBe("r2-index");
	expect(r2KindOf(`schools/${DEMO}/views/kpi/months/2026-01.json`)).toBe(
		"r2-views",
	);
});

test("a cold signed-out /v1/schools: no auth, the demo index, total", async () => {
	const fetchV1 = inProcess(memoryCache());
	const response = await fetchV1("/v1/schools", { cold: true });
	expect(response.status).toBe(200);
	const header = response.headers.get("server-timing");
	const entries = entriesOf(header);
	expect(entries.get("endpoint")).toEqual({ dur: null, desc: "schools" });
	expect(entries.get("auth")).toEqual({ dur: 0, desc: "none" });
	expect(entries.get("r2-index")?.desc).toBe("1");
	expect(entries.get("total")?.dur).toBeGreaterThanOrEqual(0);
	expectNoIds(header);
});

test("a cold stored disclosure misses the cache and reads manifest, pointer and answers; then the isolate, then the cache", async () => {
	const fetchV1 = inProcess(memoryCache());
	const path = `/v1/schools/${DEMO}/disclosure`;
	const cold = await fetchV1(path, { cold: true });
	expect(cold.status).toBe(200);
	const coldEntries = entriesOf(cold.headers.get("server-timing"));
	expect(coldEntries.get("endpoint")?.desc).toBe("disclosure");
	for (const name of ["r2-manifest", "r2-pointer", "r2-answers", "total"])
		expect(coldEntries.has(name), name).toBe(true);
	expect(coldEntries.get("cache")?.desc).toBe("miss");
	expect(coldEntries.has("fallback")).toBe(false);
	expectNoIds(cold.headers.get("server-timing"));

	// the same isolate: the copy it read from R2, the Cache API not asked
	const kept = await fetchV1(path, {});
	expect(entriesOf(kept.headers.get("server-timing")).get("cache")?.desc).toBe(
		"isolate",
	);

	// a new isolate, the same data centre: the Cache API has it
	const warm = await fetchV1(path, { cold: true });
	const warmEntries = entriesOf(warm.headers.get("server-timing"));
	expect(warmEntries.get("cache")?.desc).toBe("hit");
	expect(warmEntries.has("r2-answers")).toBe(false);
});

test("another day computes a fallback", async () => {
	const fetchV1 = inProcess(memoryCache(), DAY_MS);
	const response = await fetchV1(`/v1/schools/${DEMO}/disclosure`, {
		cold: true,
	});
	expect(response.status).toBe(200);
	const header = response.headers.get("server-timing");
	const entries = entriesOf(header);
	expect(entries.has("fallback")).toBe(true);
	expect(entries.has("cache")).toBe(false);
	expect(entries.has("r2-manifest")).toBe(true);
	expectNoIds(header);
});

test("a signed-in read times auth; an endpoint with no stored answers computes", async () => {
	const fetchV1 = inProcess(memoryCache());
	const response = await fetchV1(
		`/v1/schools/${PRESET}/ledger?from=2026-03-01&to=2026-03-31`,
		{ token, cold: true },
	);
	expect(response.status).toBe(200);
	const header = response.headers.get("server-timing");
	const entries = entriesOf(header);
	expect(entries.get("endpoint")?.desc).toBe("ledger");
	expect(entries.get("auth")?.desc).toBeNull();
	expect(entries.get("auth")?.dur).toBeGreaterThanOrEqual(0);
	expect(entries.has("compute")).toBe(true);
	expect(entries.has("fallback")).toBe(false);
	expectNoIds(header);
});

test("an error answer carries it too, and the deployed path (Miniflare) sends it", async () => {
	const fetchV1 = inProcess(memoryCache());
	const refused = await fetchV1(`/v1/schools/${PRESET}/ledger`, {});
	expect(refused.status).toBe(401);
	const refusedEntries = entriesOf(refused.headers.get("server-timing"));
	expect(refusedEntries.has("total")).toBe(true);
	expectNoIds(refused.headers.get("server-timing"));

	const served = await fetch(`${harness.url}/v1/schools`, {
		headers: { authorization: `Bearer ${token}` },
	});
	await served.arrayBuffer();
	const servedEntries = entriesOf(served.headers.get("server-timing"));
	expect(servedEntries.get("endpoint")?.desc).toBe("schools");
	expect(servedEntries.has("auth")).toBe(true);
	expect(servedEntries.has("r2-manifest")).toBe(true);
	expectNoIds(served.headers.get("server-timing"));
});
