/**
 * What the isolate keeps across requests (`data/snapshot.ts`, `routes/stored.ts`), on the real runtime: a read belongs to
 * the request that started it, and workerd cancels it when that request ends. A route that opens the views but not the
 * log (`members-income`) must leave nothing behind that a later request of the same generation waits on for ever.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import {
	type LedgerHarness,
	startLedgerWorker,
} from "../src/testing/harness.js";

const PRESET = "monthly-members";
/** Far longer than any of these answers takes on Miniflare, far shorter than the test's own timeout. */
const ANSWER_WITHIN_MS = 5000;

let harness: LedgerHarness;
let token: string;
beforeAll(async () => {
	harness = await startLedgerWorker({ presets: [PRESET] });
	token = await harness.mintToken({
		sub: "profile_isolate",
		schools: [{ id: PRESET, role: "owner", finance: true }],
	});
}, 180_000);
afterAll(async () => {
	await harness.stop();
});

/** The status of a GET, or `"no answer"` when none comes in `ANSWER_WITHIN_MS`. */
const statusOf = async (path: string): Promise<number | "no answer"> => {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const late = new Promise<"no answer">((resolve) => {
		timer = setTimeout(() => resolve("no answer"), ANSWER_WITHIN_MS);
	});
	const answered = fetch(`${harness.url}/v1/schools/${PRESET}${path}`, {
		headers: { authorization: `Bearer ${token}` },
	}).then(async (response) => {
		await response.arrayBuffer();
		return response.status;
	});
	try {
		return await Promise.race([answered, late]);
	} finally {
		clearTimeout(timer);
	}
};

test("a read of the views alone first, then the log's readers of the same generation still answer", async () => {
	const key = harness.seeded[PRESET]?.events.find(({ key }) =>
		key.startsWith("family:"),
	)?.key as string;
	// the isolate's first request of the generation: it reads the views, never the log
	expect(await statusOf("/members-income?from=2026-06-01&to=2026-06-30")).toBe(
		200,
	);
	expect({
		member: await statusOf(`/members/${encodeURIComponent(key)}/money`),
		ledger: await statusOf("/ledger?from=2026-06-01&to=2026-06-30"),
	}).toEqual({ member: 200, ledger: 200 });
}, 30_000);
