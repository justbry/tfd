/** The ship watermark: a generation's `asOf` is the scheduled time, held back to what the shipper says it has shipped. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { R2BindingStore, readViewsFromStore } from "tfd/worker";
import { watermarkKey } from "../src/data/watermark.js";
import {
	type LedgerHarness,
	startLedgerWorker,
} from "../src/testing/harness.js";
import { presetEvents } from "../src/testing/seed.js";
import { call } from "./support.js";

const IDS = [
	"none",
	"older",
	"future",
	"garbage",
	"badinstant",
	"other-school",
	"empty-body",
] as const;
const SECOND = 1000;

let harness: LedgerHarness;
let seededAsOf: number;
let now: number;
beforeAll(async () => {
	harness = await startLedgerWorker({
		presets: IDS.map(() => "tiny-school"),
		schools: IDS,
	});
	seededAsOf = Date.parse(harness.seeded.none?.asOf as string);
	now = Date.parse(harness.clock.now());
	const put = (id: string, body: string) =>
		harness.bucket.put(watermarkKey(id), new TextEncoder().encode(body), {});
	const mark = (id: string, instant: number) =>
		put(
			id,
			JSON.stringify({
				school: id,
				env: "live",
				shippedThrough: new Date(instant).toISOString(),
			}),
		);
	await mark("older", seededAsOf + 30 * SECOND);
	await mark("future", now + 3_600_000);
	await put("garbage", "this is not json");
	await put(
		"badinstant",
		JSON.stringify({
			school: "badinstant",
			env: "live",
			shippedThrough: "yesterday-ish",
		}),
	);
	await mark("other-school", seededAsOf + 30 * SECOND).then(() =>
		put(
			"other-school",
			JSON.stringify({
				school: "someone-else",
				shippedThrough: new Date(seededAsOf + 30 * SECOND).toISOString(),
			}),
		),
	);
	await put("empty-body", "{}");
	await harness.runCron();
}, 120_000);
afterAll(async () => {
	await harness.stop();
});

const manifestAsOf = async (id: string): Promise<number> => {
	const reader = await readViewsFromStore(
		new R2BindingStore(harness.bucket),
		id,
	);
	if (!reader.ok) throw new Error(`${id} has no views`);
	return Date.parse(reader.manifest.asOf);
};

describe("asOf of a views generation", () => {
	test("no watermark: the scheduled time", async () => {
		expect(await manifestAsOf("none")).toBe(now);
	});

	test("an older watermark holds asOf back to it", async () => {
		expect(await manifestAsOf("older")).toBe(seededAsOf + 30 * SECOND);
	});

	test("a future-dated watermark never raises asOf above the scheduled time", async () => {
		expect(await manifestAsOf("future")).toBe(now);
	});

	test("an unparsable one, an instant that is not one, another school's, or none in it: the scheduled time", async () => {
		for (const id of ["garbage", "badinstant", "other-school", "empty-body"])
			expect(await manifestAsOf(id), id).toBe(now);
	});
});

describe("the envelope follows it", () => {
	test("asOf and lagMinutes of an answer and of /v1/schools are the generation's", async () => {
		const token = await harness.mintToken({
			sub: "p",
			schools: IDS.map((id) => ({ id, role: "owner", finance: true })),
		});
		const schools = await call(harness, token, "/v1/schools");
		const byId = Object.fromEntries(
			(
				schools.body.data as {
					schools: { id: string; asOf: string; lagMinutes: number }[];
				}
			).schools.map((s) => [s.id, s]),
		);
		expect(Date.parse(byId.older?.asOf as string)).toBe(
			seededAsOf + 30 * SECOND,
		);
		expect(byId.older?.lagMinutes).toBe(
			Math.ceil((now - seededAsOf - 30 * SECOND) / 60_000),
		);
		expect(byId.none?.lagMinutes).toBe(0);
		expect(byId.future?.lagMinutes).toBe(0);
		const kpi = await call(
			harness,
			token,
			"/v1/schools/older/kpi?audience=owner&pin=open",
		);
		expect(Date.parse(kpi.body.asOf as string)).toBe(seededAsOf + 30 * SECOND);
		expect(kpi.body.lagMinutes).toBe(byId.older?.lagMinutes as number);
	});

	test("events after the watermark are not in the generation", async () => {
		const events = presetEvents("tiny-school");
		const middle = events.map((event) => event.event_time).sort()[
			Math.floor(events.length / 2)
		] as string;
		await harness.seedEvents("cut", events, { views: false });
		await harness.bucket.put(
			watermarkKey("cut"),
			new TextEncoder().encode(
				JSON.stringify({ school: "cut", env: "live", shippedThrough: middle }),
			),
			{},
		);
		await harness.runCron();
		const token = await harness.mintToken({
			sub: "p",
			schools: [{ id: "cut", role: "owner", finance: true }],
		});
		const day = (offset: number) =>
			new Date(Date.parse(middle) + offset * 86_400_000)
				.toISOString()
				.slice(0, 10);
		const [from, to] = [day(-30), day(30)];
		const ledger = await call(
			harness,
			token,
			`/v1/schools/cut/ledger?from=${from}&to=${to}`,
		);
		expect(Date.parse(ledger.body.asOf as string)).toBe(Date.parse(middle));
		const page = ledger.body.data as {
			days: { entries: { event: { event_time: string } }[] }[];
		};
		const times = page.days.flatMap((day) =>
			day.entries.map((entry) => Date.parse(entry.event.event_time)),
		);
		expect(times.length).toBeGreaterThan(0);
		expect(Math.max(...times)).toBeLessThanOrEqual(Date.parse(middle));
		const everything = events.filter(
			(event) => event.date >= from && event.date <= to,
		);
		expect(times.length).toBeLessThan(everything.length);
	});
});
