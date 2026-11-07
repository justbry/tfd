/** The views job: every school's prefix gets its views, one school's failure stops no other, and a failure is logged by school id only. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { R2BindingStore, readViewsFromStore } from "atm/worker";
import {
	type LedgerHarness,
	startLedgerWorker,
} from "../src/testing/harness.js";
import { presetEvents } from "../src/testing/seed.js";
import { runViewsJob, schoolIdsIn } from "../src/views-job.js";
import { call } from "./support.js";

let harness: LedgerHarness;
let store: R2BindingStore;
beforeAll(async () => {
	harness = await startLedgerWorker({
		presets: ["tiny-school", "free-only"],
		schools: ["b-good", "c-good"],
	});
	store = new R2BindingStore(harness.bucket);
}, 120_000);
afterAll(async () => {
	await harness.stop();
});

const manifestAsOf = async (school: string): Promise<string | null> => {
	const reader = await readViewsFromStore(store, school);
	return reader.ok ? reader.manifest.asOf : null;
};

const captureErrors = async <Result>(run: () => Promise<Result>) => {
	const logged: unknown[][] = [];
	const original = console.error;
	console.error = (...args: unknown[]) => void logged.push(args);
	try {
		return { result: await run(), logged };
	} finally {
		console.error = original;
	}
};

describe("the views job", () => {
	test("lists every school prefix in the bucket", async () => {
		expect(await schoolIdsIn(store)).toEqual(["b-good", "c-good"]);
	});

	test("two schools, one failing: the other still gets its views, and the log names the school only", async () => {
		// "a-broken" sorts first and its log is not JSONL: the job must go on to the schools after it
		await harness.bucket.put(
			"schools/a-broken/events/date=2026-03-01/day.jsonl",
			new TextEncoder().encode(
				'{"id": "01KN3N5H900000NYS3RVZJKN29", "key": "family:fam_secret"\nnot json at all\n',
			),
			{},
		);
		const asOf = new Date(Date.parse(harness.clock.now()) + 3_600_000);
		const { result, logged } = await captureErrors(() =>
			runViewsJob(store, asOf),
		);
		expect(result.map((entry) => [entry.school, entry.ok])).toEqual([
			["a-broken", false],
			["b-good", true],
			["c-good", true],
		]);
		expect(Date.parse((await manifestAsOf("b-good")) as string)).toBe(
			asOf.getTime(),
		);
		expect(Date.parse((await manifestAsOf("c-good")) as string)).toBe(
			asOf.getTime(),
		);
		expect(await manifestAsOf("a-broken")).toBeNull();
		expect(logged).toEqual([["views job failed for school a-broken"]]);
		expect(JSON.stringify(logged)).not.toMatch(/family:|fam_|01KN/);
	});

	test("a log that cannot be replayed is recorded, so the Worker says so; fixed, the next run clears it", async () => {
		const events = presetEvents("tiny-school");
		const withoutPlans = events.filter(
			(event) =>
				event.event_type !== "plan.changed" &&
				event.event_type !== "catalog.published",
		);
		await harness.seedEvents("d-replay", withoutPlans, { views: false });
		const token = await harness.mintToken({
			sub: "p",
			schools: [{ id: "d-replay", role: "owner", finance: true }],
		});
		const path = "/v1/schools/d-replay/kpi?audience=owner&pin=open";
		const asOf = new Date(Date.parse(harness.clock.now()) + 7_200_000);
		const first = await captureErrors(() => runViewsJob(store, asOf));
		const broken = first.result.find((entry) => entry.school === "d-replay");
		expect(broken?.ok).toBe(false);
		expect((await call(harness, token, path)).status).toBe(503);
		// the same school with its catalog and plans back: the job reads the whole log again
		await harness.seedEvents("d-replay", events, { views: false });
		const second = await runViewsJob(store, new Date(asOf.getTime() + 300_000));
		expect(second.find((entry) => entry.school === "d-replay")).toEqual({
			school: "d-replay",
			ok: true,
		});
		expect((await call(harness, token, path)).status).toBe(200);
	});

	test("the cron trigger runs the job at the Worker's clock", async () => {
		harness.clock.advance(3 * 3_600_000);
		await harness.runCron();
		expect(Date.parse((await manifestAsOf("b-good")) as string)).toBe(
			Date.parse(harness.clock.now()),
		);
		const token = await harness.mintToken({
			sub: "p",
			schools: [{ id: "b-good", role: "owner", finance: true }],
		});
		const reply = await call(harness, token, "/v1/schools");
		expect(Date.parse(reply.body.asOf as string)).toBe(
			Date.parse(harness.clock.now()),
		);
		expect(reply.body.lagMinutes).toBe(0);
	});
});
