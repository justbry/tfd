/**
 * What the isolate keeps of the JWKS (`auth/jwks.ts`), on the real runtime: a fetch belongs to the request that started
 * it, and workerd cancels it when that request ends. The first request of an isolate starts the JWKS fetch; if it ends
 * before the answer comes, no later request may wait on that fetch for ever.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import {
	type LedgerHarness,
	startLedgerWorker,
} from "../src/testing/harness.js";

const PRESET = "monthly-members";
/** Far longer than this answer takes on Miniflare, and shorter than the Worker's own 5 s timeout on a JWKS fetch, so that timeout cannot rescue a request that waits for ever. */
const ANSWER_WITHIN_MS = 4000;

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

const get = (signal?: AbortSignal): Promise<Response> =>
	fetch(
		`${harness.url}/v1/schools/${PRESET}/members-income?from=2026-06-01&to=2026-06-30`,
		{
			headers: { authorization: `Bearer ${token}` },
			signal,
		},
	);

test("a request that ends with the JWKS fetch unanswered leaves no wait behind for the next", async () => {
	const held = harness.jwks.holdNext();
	const first = new AbortController();
	const firstEnded = get(first.signal).then(
		() => "answered",
		() => "ended",
	);
	// the isolate is new: this request starts the JWKS fetch, and ends before the answer
	await held.arrived;
	first.abort();
	expect(await firstEnded).toBe("ended");

	let timer: ReturnType<typeof setTimeout> | undefined;
	const late = new Promise<"no answer">((resolve) => {
		timer = setTimeout(() => resolve("no answer"), ANSWER_WITHIN_MS);
	});
	const answered = get().then(async (response) => {
		await response.arrayBuffer();
		return response.status;
	});
	try {
		expect(await Promise.race([answered, late])).toBe(200);
	} finally {
		clearTimeout(timer);
		held.release();
	}
}, 30_000);
