/** The UI's static assets beside the API: the SPA fallback for pages, the Worker first for /v1 and /healthz. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	type LedgerHarness,
	startLedgerWorker,
} from "../src/testing/harness.js";

let harness: LedgerHarness;
beforeAll(async () => {
	harness = await startLedgerWorker({ presets: ["tiny-school"] });
}, 120_000);
afterAll(async () => {
	await harness.stop();
});

test("/ and an unknown page are the asset (the single-page fallback)", async () => {
	for (const path of ["/", "/index.html", "/ledger/members/42"]) {
		const response = await fetch(`${harness.url}${path}`);
		expect(response.status, path).toBe(200);
		expect(await response.text(), path).toContain("ledger ui");
	}
});

test("an unknown /v1 path is the Worker's JSON 404, not the asset", async () => {
	const token = await harness.mintToken({
		sub: "p",
		schools: [{ id: "tiny-school", role: "owner", finance: true }],
	});
	const response = await fetch(`${harness.url}/v1/x`, {
		headers: { authorization: `Bearer ${token}` },
	});
	expect(response.status).toBe(404);
	expect(response.headers.get("content-type")).toContain("application/json");
	expect(
		((await response.json()) as { error: { code: string } }).error.code,
	).toBe("not_found");
	// no token: the Worker answers 401, the asset is never offered for an API path
	expect((await fetch(`${harness.url}/v1/x`)).status).toBe(401);
	expect(await (await fetch(`${harness.url}/healthz`)).json()).toEqual({
		ok: true,
	});
});

test("wrangler.jsonc binds the same assets, Worker first, in both environments", () => {
	const config = readFileSync(
		join(import.meta.dir, "../wrangler.jsonc"),
		"utf8",
	);
	const parsed = JSON.parse(config.replace(/^\s*\/\/.*$/gm, "")) as {
		env: Record<string, { assets: Record<string, unknown> }>;
	};
	for (const environment of ["staging", "production"])
		expect(parsed.env[environment]?.assets).toEqual({
			directory: "../ledger-ui/dist",
			binding: "ASSETS",
			not_found_handling: "single-page-application",
			run_worker_first: ["/v1/*", "/healthz"],
		});
});

test("the environments' buckets, issuers and cron", () => {
	const config = readFileSync(
		join(import.meta.dir, "../wrangler.jsonc"),
		"utf8",
	);
	const parsed = JSON.parse(config.replace(/^\s*\/\/.*$/gm, "")) as {
		env: Record<
			string,
			{
				r2_buckets: { binding: string; bucket_name: string }[];
				vars: Record<string, string>;
				triggers: { crons: string[] };
			}
		>;
	};
	expect(parsed.env.staging?.r2_buckets).toEqual([
		{ binding: "LEDGER_BUCKET", bucket_name: "b4uni-stg-ledger" },
	]);
	expect(parsed.env.production?.r2_buckets).toEqual([
		{ binding: "LEDGER_BUCKET", bucket_name: "b4uni-prod-ledger" },
	]);
	expect(parsed.env.staging?.vars.LEDGER_ISS).toBe(
		"https://api-staging.b4uni.com",
	);
	expect(parsed.env.production?.vars.LEDGER_ISS).toBe("https://api.b4uni.com");
	for (const environment of ["staging", "production"])
		expect(parsed.env[environment]?.triggers.crons).toEqual(["*/5 * * * *"]);
});
