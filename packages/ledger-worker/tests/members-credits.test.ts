/** The credits of the members, from the credit events: a log on two menu versions, a log with an adjustment, and a log with none. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bundleLog } from "tfd/scenarios";
import { membersOf } from "tfd/worker";
import {
	type LedgerHarness,
	startLedgerWorker,
} from "../src/testing/harness.js";
import { presetEvents } from "../src/testing/seed.js";
import { call } from "./support.js";

const VERSIONS = "versions";
const ADJUST = "adjust";
const MONEY_ONLY = "money-only";
const OTHER = "other";
const BY_CRON = "by-cron";
const MONEY_AND_MENU = /^(payment|catalog)\./;
let harness: LedgerHarness;
let token: string;
let twoVersions: Awaited<ReturnType<typeof bundleLog>>;

beforeAll(async () => {
	harness = await startLedgerWorker({ presets: [] });
	twoVersions = await bundleLog("credits-menu-version");
	const adjusted = await bundleLog("credits-adjust-never-expires");
	await harness.seedEvents(VERSIONS, twoVersions.events);
	await harness.seedEvents(ADJUST, adjusted.events);
	await harness.seedEvents(
		MONEY_ONLY,
		presetEvents("monthly-members").filter((event) =>
			MONEY_AND_MENU.test(event.event_type),
		),
	);
	// the views of this one are left to the cron job (the job's own run over a log of two menu versions)
	await harness.seedEvents(BY_CRON, twoVersions.events, { views: false });
	token = await harness.mintToken({
		sub: "p",
		schools: [VERSIONS, ADJUST, MONEY_ONLY, BY_CRON].map((id) => ({
			id,
			role: "admin",
			finance: false,
		})),
	});
}, 120_000);
afterAll(async () => {
	await harness.stop();
});

const get = (school: string, bearer: string | null = token) =>
	call(harness, bearer, `/v1/schools/${school}/members-credits`);

describe("members-credits", () => {
	test("a log on two menu versions gives each member the balance of their own version, as membersOf counts them", async () => {
		expect(twoVersions.versions).toEqual(["1", "2"]);
		const reply = await get(VERSIONS);
		expect(reply.status).toBe(200);
		const data = reply.body.data as {
			hasCreditEvents: boolean;
			unit: { one: string; other: string } | null;
			creditsOutstanding: number;
			members: Array<{
				key: string;
				features: Record<string, { available: number }>;
			}>;
		};
		const asOf = reply.body.asOf as string;
		const expected = membersOf(twoVersions.events, new Date(asOf));
		if (!expected.ok) throw new Error("the bundle log must replay");
		expect(data.hasCreditEvents).toBe(true);
		expect(data.unit).toEqual({ one: "visit", other: "visits" });
		expect(data.members.map((member) => member.key)).toEqual([
			"family:fam_8k2",
			"family:fam_b2",
		]);
		expect(data.members).toEqual(Object.values(expected.members));
		expect(data.creditsOutstanding).toBe(7);
		expect(
			data.members.map((member) => member.features.visit?.available),
		).toEqual([4, 3]);
	});

	test("the cron job builds the views of a log of credit events on two menu versions, and the credits follow", async () => {
		expect((await get(BY_CRON)).status).toBe(404);
		await harness.runCron();
		const reply = await get(BY_CRON);
		expect(reply.status).toBe(200);
		const same = await get(VERSIONS);
		expect((reply.body.data as { members: unknown }).members).toEqual(
			(same.body.data as { members: unknown }).members,
		);
	});

	test("an adjustment counts and never expires", async () => {
		const reply = await get(ADJUST);
		const data = reply.body.data as {
			creditsOutstanding: number;
			members: Array<{
				features: Record<string, { available: number; nextExpiryAt: unknown }>;
			}>;
		};
		expect(data.creditsOutstanding).toBe(5);
		expect(data.members[0]?.features.visit?.nextExpiryAt).toBeNull();
	});

	test("a log with no credit event says so and sends no figure", async () => {
		const reply = await get(MONEY_ONLY);
		expect(reply.status).toBe(200);
		expect(reply.body.data).toEqual({ hasCreditEvents: false });
	});

	test("the token must list the school; no token is 401", async () => {
		expect((await get(OTHER)).status).toBe(404);
		expect((await get(VERSIONS, null)).status).toBe(401);
	});

	test("no name or email is in the answer", async () => {
		const text = JSON.stringify((await get(VERSIONS)).body);
		expect(text).not.toMatch(
			/[\w.+-]+@[\w-]+\.[a-z]{2,}|billing_name|billing_email/i,
		);
	});
});
