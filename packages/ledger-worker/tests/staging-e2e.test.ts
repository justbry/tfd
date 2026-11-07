/** The S8f staging script: its stage 1 against the local Worker, and the allow-list that keeps it off production. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type Context,
	exitCodeOf,
	findFixtureNames,
	fixtureSchoolNames,
	type Inputs,
	LEDGER_ORIGIN,
	newReport,
	parseArgs,
	type Result,
	registerSecret,
	resolveTargets,
	runStages,
	STAGING_API,
	STAGING_WORKER,
	scrub,
	summarize,
	UsageError,
} from "../scripts/staging-e2e.js";
import {
	type LedgerHarness,
	startLedgerWorker,
} from "../src/testing/harness.js";

const NO_INPUTS: Inputs = {
	qaEmail: undefined,
	pin: undefined,
	adminEmail: undefined,
	adminPin: undefined,
	schoolId: undefined,
	paymentId: undefined,
	refundCents: undefined,
	bookingId: undefined,
};

let harness: LedgerHarness;
let api: ReturnType<typeof Bun.serve>;
let assets: string;

beforeAll(async () => {
	assets = await mkdtemp(join(tmpdir(), "s8f-assets-"));
	await mkdir(join(assets, "assets"));
	await writeFile(
		join(assets, "index.html"),
		'<!doctype html><html><head><script type="module" crossorigin src="/assets/app.js"></script><link rel="stylesheet" href="/assets/app.css"></head><body><div id="app"></div></body></html>\n',
	);
	await writeFile(
		join(assets, "assets", "app.js"),
		'const api="https://api-staging.b4uni.com";const copy="The school uses the B4 Uni file.";export{api,copy};\n',
	);
	await writeFile(join(assets, "assets", "app.css"), "body{margin:0}\n");
	harness = await startLedgerWorker({
		presets: ["tiny-school"],
		assetsDirectory: assets,
	});
	api = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request) {
			const path = new URL(request.url).pathname;
			if (path === "/.well-known/ledger-jwks.json")
				return Response.json({ keys: harness.jwks.keys() });
			if (request.method === "OPTIONS") {
				const origin = request.headers.get("origin");
				const headers = new Headers();
				if (origin === LEDGER_ORIGIN) {
					headers.set("access-control-allow-origin", origin);
					headers.set("access-control-allow-credentials", "true");
				}
				return new Response(null, { status: 204, headers });
			}
			return new Response(null, { status: 404 });
		},
	});
}, 120_000);

afterAll(async () => {
	api.stop(true);
	await harness.stop();
	await rm(assets, { recursive: true, force: true });
});

const contextFor = (inputs: Inputs = NO_INPUTS): Context => ({
	targets: resolveTargets(
		{ worker: harness.url, api: `http://127.0.0.1:${api.port}` },
		{ extraAllowedOrigins: [harness.url, `http://127.0.0.1:${api.port}`] },
	),
	report: newReport(() => undefined),
	inputs,
	qaLink: async () => ({ error: "no fly in tests" }),
	sleep: async () => undefined,
	log: () => undefined,
});

test("stage 1 passes every check against the local Worker", async () => {
	const context = contextFor();
	await runStages(context, [1]);
	const lines = context.report.results.map(
		(result) => `${result.status} ${result.check}: ${result.why}`,
	);
	expect(
		context.report.results.filter((result) => result.status !== "PASS"),
		lines.join("\n"),
	).toEqual([]);
	expect(context.report.results.map((result) => result.check)).toEqual([
		"healthz",
		"no-token",
		"forged-signature",
		"forged-expired",
		"alg-none",
		"wrong-aud",
		"cors-preflight",
		"cors-prod-origin",
		"index-html",
		"assets",
		"bundle-api-host",
		"bundle-no-fixtures",
		"spa-fallback",
		"jwks",
	]);
});

test("the refusals of stage 1 are not vacuous: a real token passes the same route", async () => {
	const token = await harness.mintToken({
		sub: "profile_s8f",
		schools: [{ id: "tiny-school", role: "owner", finance: true }],
	});
	const response = await fetch(`${harness.url}/v1/schools`, {
		headers: { authorization: `Bearer ${token}` },
	});
	expect(response.status).toBe(200);
});

test("stage 1 FAILs a bundle that is missing the staging api host", async () => {
	const other = await mkdtemp(join(tmpdir(), "s8f-assets-bad-"));
	await mkdir(join(other, "assets"));
	await writeFile(
		join(other, "index.html"),
		'<script type="module" src="/assets/app.js"></script>\n',
	);
	await writeFile(
		join(other, "assets", "app.js"),
		'const api="https://api.b4uni.com";const school="Maple Pilates";\n',
	);
	const bad = await startLedgerWorker({
		presets: ["tiny-school"],
		assetsDirectory: other,
	});
	try {
		const context = contextFor();
		context.targets = resolveTargets(
			{ worker: bad.url, api: `http://127.0.0.1:${api.port}` },
			{ extraAllowedOrigins: [bad.url, `http://127.0.0.1:${api.port}`] },
		);
		await runStages(context, [1]);
		const byCheck = Object.fromEntries(
			context.report.results.map((result) => [result.check, result]),
		);
		expect(byCheck["bundle-api-host"]?.status).toBe("FAIL");
		expect(byCheck["bundle-no-fixtures"]?.status).toBe("FAIL");
		expect(byCheck["bundle-no-fixtures"]?.why).toContain("Maple Pilates");
	} finally {
		await bad.stop();
		await rm(other, { recursive: true, force: true });
	}
}, 120_000);

test("stages 2 to 4 without inputs are BLOCKED, name what is missing and touch nothing", async () => {
	const context = contextFor();
	await runStages(context, [2, 3, 4]);
	const { results } = context.report;
	expect(results.length).toBeGreaterThanOrEqual(4);
	expect(results.every((result) => result.status === "BLOCKED")).toBe(true);
	const text = results.map((result) => result.why).join("\n");
	expect(text).toContain("S8F_QA_EMAIL");
	expect(text).toContain("S8F_PAYMENT_ID");
	expect(text).toContain("S8F_REFUND_CENTS");
	expect(exitCodeOf(results, false)).toBe(0);
	expect(exitCodeOf(results, true)).toBe(1);
});

test("the allow-list takes the two staging origins and nothing else", () => {
	expect(resolveTargets({})).toEqual({
		worker: STAGING_WORKER,
		api: STAGING_API,
	});
	expect(
		resolveTargets({ worker: `${STAGING_WORKER}/`, api: STAGING_API }),
	).toEqual({ worker: STAGING_WORKER, api: STAGING_API });
});

test("the allow-list refuses production and every other host", () => {
	const refused = [
		"https://ledger.b4uni.com",
		"https://api.b4uni.com",
		"https://b4uni.com",
		"https://staging.b4uni.com",
		"https://evil.example",
		"https://ledger-staging.b4uni.com.evil.example",
		"https://ledger-staging.b4uni.com@evil.example",
		"http://ledger-staging.b4uni.com",
		"https://ledger-staging.b4uni.com:8443",
		"https://ledger-staging.b4uni.com/v1",
		"http://127.0.0.1:8787",
		"not a url",
	];
	for (const host of refused) {
		expect(() => resolveTargets({ worker: host }), host).toThrow(UsageError);
		expect(() => resolveTargets({ api: host }), host).toThrow(UsageError);
	}
	// the right host in the wrong role
	expect(() => resolveTargets({ worker: STAGING_API })).toThrow(UsageError);
	expect(() => resolveTargets({ api: STAGING_WORKER })).toThrow(UsageError);
});

test("an injected origin allows only itself, and production stays refused with it", () => {
	const extra = { extraAllowedOrigins: ["http://127.0.0.1:9"] };
	expect(resolveTargets({ worker: "http://127.0.0.1:9" }, extra).worker).toBe(
		"http://127.0.0.1:9",
	);
	expect(() => resolveTargets({ worker: "http://127.0.0.1:8" }, extra)).toThrow(
		UsageError,
	);
	expect(() =>
		resolveTargets({ worker: "https://ledger.b4uni.com" }, extra),
	).toThrow(UsageError);
	expect(() => resolveTargets({ api: "https://api.b4uni.com" }, extra)).toThrow(
		UsageError,
	);
});

test("the environment cannot widen the allow-list", () => {
	const before = process.env.S8F_ALLOW;
	process.env.S8F_ALLOW = "https://ledger.b4uni.com,https://api.b4uni.com";
	try {
		expect(() =>
			resolveTargets({ worker: "https://ledger.b4uni.com" }),
		).toThrow(UsageError);
	} finally {
		if (before === undefined) delete process.env.S8F_ALLOW;
		else process.env.S8F_ALLOW = before;
	}
});

test("fixture school names are read from the UI fixtures and found in a bundle", async () => {
	const names = await fixtureSchoolNames();
	expect(names).toEqual(
		expect.arrayContaining([
			"Vibes of Light",
			"B4 Uni",
			"Maple Pilates",
			"Lotus Lane Yoga",
			"Harbor Arts Academy",
		]),
	);
	expect(findFixtureNames('x="Lotus Lane Yoga";', names)).toEqual([
		"Lotus Lane Yoga",
	]);
	// the product's own words are not a fixture school ...
	expect(findFixtureNames("uses the B4 Uni file.", names)).toEqual([]);
	// ... a whole string literal of the name is
	expect(findFixtureNames('{name:"B4 Uni",id:"b4u"}', names)).toEqual([
		"B4 Uni",
	]);
});

test("arguments: stages, flags, and the safe default that leaves stage 4 out", () => {
	expect(parseArgs([])).toEqual({
		stages: [1, 2, 3],
		json: false,
		strict: false,
	});
	expect(parseArgs(["--stage", "1,4", "--json", "--strict"])).toEqual({
		stages: [1, 4],
		json: true,
		strict: true,
	});
	expect(() => parseArgs(["--stage", "9"])).toThrow(UsageError);
	expect(() => parseArgs(["--host", "x"])).toThrow(UsageError);
});

test("exit code and summary: FAIL always fails, BLOCKED only with --strict", () => {
	const make = (...statuses: Result["status"][]): Result[] =>
		statuses.map((status, index) => ({
			stage: index < 2 ? 1 : 2,
			check: `c${index}`,
			status,
			why: "",
		}));
	expect(exitCodeOf(make("PASS", "BLOCKED"), false)).toBe(0);
	expect(exitCodeOf(make("PASS", "BLOCKED"), true)).toBe(1);
	expect(exitCodeOf(make("PASS", "FAIL"), false)).toBe(1);
	expect(summarize(make("PASS", "FAIL", "BLOCKED"))).toEqual([
		{ stage: 1, pass: 1, fail: 1, blocked: 0 },
		{ stage: 2, pass: 0, fail: 0, blocked: 1 },
	]);
});

test("tokens, PINs and cookies print as their first four characters at most", () => {
	registerSecret("987654321");
	const part = (value: string) => Buffer.from(value).toString("base64url");
	const jwt = `${part('{"alg":"EdDSA"}')}.${part('{"sub":"secret"}')}.${part("signature-bytes")}`;
	const text = scrub(
		`pin 987654321 token ${jwt} cookie b4u_session=abcdef0123456789`,
	);
	expect(text).not.toContain("987654321");
	expect(text).not.toContain(part('{"sub":"secret"}'));
	expect(text).not.toContain("abcdef0123456789");
	expect(text).toContain("9876…");
});
