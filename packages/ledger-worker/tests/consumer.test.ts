/**
 * The harness as another package's tests use it (the ledger UI's gates): start the real Worker over seeded schools, mint a
 * token, fetch `/v1`, stop. Only the harness's own entry point and plain `fetch` are used.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { startLedgerWorker } from "../src/testing/harness.js";

let harness: Awaited<ReturnType<typeof startLedgerWorker>>;
beforeAll(async () => {
	harness = await startLedgerWorker({
		presets: ["monthly-members", "free-only"],
		schools: ["b4u", "har"],
	});
}, 120_000);
afterAll(async () => {
	await harness.stop();
});

test("a consumer reads its schools with a minted token", async () => {
	const token = await harness.mintToken({
		sub: "profile_kim",
		schools: [
			{ id: "b4u", role: "owner", finance: true },
			{ id: "har", role: "admin", finance: false },
		],
		expiresInSeconds: 120,
	});
	const headers = { authorization: `Bearer ${token}` };
	const schools = await fetch(`${harness.url}/v1/schools`, { headers });
	expect(schools.status).toBe(200);
	const body = (await schools.json()) as {
		data: { schools: { id: string }[] };
	};
	expect(body.data.schools.map((school) => school.id)).toEqual(["b4u", "har"]);

	const ledger = await fetch(
		`${harness.url}/v1/schools/b4u/ledger?from=2026-03-01&to=2026-03-31`,
		{ headers },
	);
	expect(ledger.status).toBe(200);
	const refused = await fetch(
		`${harness.url}/v1/schools/har/ledger?from=2026-03-01&to=2026-03-31`,
		{ headers },
	);
	expect(refused.status).toBe(403);
	const health = await fetch(`${harness.url}/healthz`);
	expect(await health.json()).toEqual({ ok: true });
});

test("a token the harness did not mint is refused", async () => {
	const response = await fetch(`${harness.url}/v1/schools`, {
		headers: { authorization: "Bearer nope" },
	});
	expect(response.status).toBe(401);
});

test("the harness refuses two presets as one school and a short list of ids", async () => {
	await expect(
		startLedgerWorker({ presets: ["free-only", "free-only"] }),
	).rejects.toThrow(/one school id/);
	await expect(
		startLedgerWorker({ presets: ["free-only"], schools: [] }),
	).rejects.toThrow(/one id for each/);
});
