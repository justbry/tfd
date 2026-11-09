/** Stage 7 of the staging script (credit events, T12): its fixture schools, a run against the local Worker, and its refusals. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { R2BindingStore } from "tfd/worker";
import {
	CREDIT_FIXTURES,
	type CreditDependencies,
	creditLogs,
	S8F_CREDIT_CHECKS,
	stage7,
} from "../scripts/staging-credits.js";
import {
	type Context,
	DEFAULT_STAGES,
	newReport,
	parseArgs,
	resolveTargets,
} from "../scripts/staging-e2e.js";
import {
	type LedgerHarness,
	startLedgerWorker,
} from "../src/testing/harness.js";

let harness: LedgerHarness;
let dependencies: CreditDependencies;

beforeAll(async () => {
	harness = await startLedgerWorker({
		presets: [],
		demoPresets: ["free-only"],
	});
	const logs = await creditLogs();
	dependencies = {
		openStore: async () => ({ store: new R2BindingStore(harness.bucket) }),
		logs: async () => logs,
		now: () => Date.parse(harness.clock.now()),
	};
}, 120_000);

afterAll(async () => {
	await harness.stop();
});

const contextFor = (): Context => ({
	targets: resolveTargets(
		{ worker: harness.url, api: "http://127.0.0.1:9" },
		{ extraAllowedOrigins: [harness.url, "http://127.0.0.1:9"] },
	),
	report: newReport(() => undefined),
	inputs: {} as Context["inputs"],
	qaLink: async () => ({ error: "no fly in tests" }),
	sleep: async () => undefined,
	log: () => undefined,
});

const linesOf = (context: Context): string =>
	context.report.results
		.map((result) => `${result.status} ${result.check}: ${result.why}`)
		.join("\n");

test("stage 7 runs only when asked: not in the default, and --stage 7 takes it", () => {
	expect(DEFAULT_STAGES).not.toContain(7);
	expect(parseArgs(["--stage", "7"]).stages).toEqual([7]);
});

test("the fixture schools are the stage's own demo prefixes, one per log", () => {
	expect(CREDIT_FIXTURES.map((fixture) => fixture.school)).toEqual([
		"demo-s8f-credits-versions",
		"demo-s8f-credits-adjust",
		"demo-s8f-no-credits",
	]);
});

test("stage 7 passes every check against the local Worker, and a second run changes nothing", async () => {
	const first = contextFor();
	await stage7(first, dependencies);
	expect(
		first.report.results.filter((result) => result.status !== "PASS"),
		linesOf(first),
	).toEqual([]);
	expect(first.report.results.map((result) => result.check)).toEqual([
		...S8F_CREDIT_CHECKS,
	]);
	const second = contextFor();
	await stage7(second, dependencies);
	expect(
		second.report.results.filter((result) => result.status !== "PASS"),
		linesOf(second),
	).toEqual([]);
	expect(second.report.results[0]?.why).toContain("written 0");
});

test("without the R2 key every check is BLOCKED and says why", async () => {
	const context = contextFor();
	await stage7(context, {
		...dependencies,
		openStore: async () => ({ blocked: "no R2 key here" }),
	});
	expect(context.report.results.map((result) => result.status)).toEqual(
		S8F_CREDIT_CHECKS.map(() => "BLOCKED"),
	);
	expect(context.report.results[0]?.why).toBe("no R2 key here");
});

test("a log for a school the stage does not own is refused before anything else is written", async () => {
	const context = contextFor();
	await stage7(context, {
		...dependencies,
		logs: async () => ({ "demo-monthly-members": [] }),
	});
	const seed = context.report.results.find((result) => result.check === "seed");
	expect(seed?.status).toBe("FAIL");
	expect(seed?.why).toContain("is not one of this stage's schools");
});
