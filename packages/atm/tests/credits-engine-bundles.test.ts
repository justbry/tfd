/**
 * The D12 golden bundles (`fixtures/scenarios/credits-*`), read at the level of their events: the instants and amounts of
 * each credit line, written by hand from the decisions in `plans/credits-engine/decisions.md`. The bundles' own checks
 * (`scenario-bundles.test.ts`) hold the hashes and the final balances; this holds the story between them, so a decision
 * that changes shows here by name. The import bundle is also compared with the family service's own rules
 * (`tests/caller-lots.ts`) at three instants.
 */
import { describe, expect, test } from "bun:test";
import {
	loadScenarioBundle,
	resolveBundleDirectory,
} from "../src/scenario/bundle.js";
import { runBundle } from "../src/scenario/bundle-run.js";
import type { AtmEvent } from "../src/types.js";
import { callerAvail, callerGrant } from "./caller-lots.js";
import { FAMILY } from "./handler-harness.js";

const AVAIL = (family: string) => `credits:avail:family:${family}:visit`;

type Line = [at: string, type: string, credits: number];

/** The events that moved a family's visits, as [instant, type, credits]. */
const creditLines = (events: readonly AtmEvent[], family = FAMILY): Line[] =>
	events.flatMap((event): Line[] => {
		const posting = event.postings.find((p) => p.account === AVAIL(family));
		return posting
			? [[event.event_time, event.event_type, Number(posting.amount)]]
			: [];
	});

/** What the visits of a family add up to at an instant: the credit lines up to it. */
const availAt = (events: readonly AtmEvent[], at: string, family = FAMILY) =>
	creditLines(events, family)
		.filter(([time]) => time <= at)
		.reduce((total, [, , credits]) => total + credits, 0);

const eventsOf = async (id: string): Promise<AtmEvent[]> => {
	const bundle = await loadScenarioBundle(resolveBundleDirectory(id));
	const run = await runBundle(bundle, { channels: [] });
	try {
		return run.schools[0]?.events ?? [];
	} finally {
		await run.dispose();
	}
};

describe("credits-rollover-cap (decision 1)", () => {
	test("each renewal loses what the rollover cap of 1 leaves out", async () => {
		expect(creditLines(await eventsOf("credits-rollover-cap"))).toEqual([
			["2026-01-15T18:00:00Z", "credit.granted", 2],
			// 15 February: 2 unused, 1 may be carried: 1 lost, 2 granted
			["2026-02-15T18:00:00.001Z", "credit.expired", -1],
			["2026-02-15T18:00:00.001Z", "credit.granted", 2],
			// 15 March 18:00: the carried 1 lapses; the renewal then loses 1 of the 2 unused again and grants 2
			["2026-03-15T18:00:00Z", "credit.expired", -1],
			["2026-03-15T18:00:00.001Z", "credit.expired", -1],
			["2026-03-15T18:00:00.001Z", "credit.granted", 2],
		]);
	});
});

describe("credits-immediate-upgrade (decision 2)", () => {
	test("the extra visit is granted when the upgrade invoice is paid, not at the next renewal", async () => {
		const lines = creditLines(await eventsOf("credits-immediate-upgrade"));
		expect(lines).toEqual([
			["2026-01-15T18:00:00Z", "credit.granted", 1],
			// sparkle-1 to sparkle-2 ten days in: 1 more visit, 21/31 of it rounded up
			["2026-01-25T18:00:00Z", "credit.adjusted", 1],
			// the 2 unused carry over (cap 2), 2 are granted
			["2026-02-15T18:00:00.001Z", "credit.granted", 2],
		]);
	});
});

describe("credits-zoned-expiry (decision 3, rules version 2)", () => {
	test("a rollover lapses at the same Denver wall-clock time a month on, an hour earlier in UTC across the 8 March change", async () => {
		expect(creditLines(await eventsOf("credits-zoned-expiry"))).toEqual([
			["2026-01-15T18:00:00Z", "credit.granted", 2],
			["2026-02-15T18:00:00.001Z", "credit.granted", 2],
			// 15 February 11:00 MST + 1 month = 15 March 11:00 MDT = 17:00 UTC (rules version 1: 18:00 UTC)
			["2026-03-15T17:00:00Z", "credit.expired", -2],
			["2026-03-15T18:00:00.001Z", "credit.granted", 2],
			// 15 March 12:00 MDT + 1 month = 15 April 12:00 MDT = 18:00 UTC: the cron at 17:30 books nothing, the one at 18:30 does
			["2026-04-15T18:00:00Z", "credit.expired", -2],
		]);
	});
});

describe("credits-lapse (decision 4)", () => {
	test("the cron books a lapsed rollover once; an unpaid cycle's tier row waits for the subscription to end", async () => {
		const events = await eventsOf("credits-lapse");
		expect(creditLines(events)).toEqual([
			["2026-01-15T18:00:00Z", "credit.granted", 2],
			["2026-02-15T18:00:00.001Z", "credit.granted", 2],
			// 16 March, twice: the 2 carried on 15 February lapsed at 15 March 18:00; the tier row's 2 are not booked
			["2026-03-15T18:00:00Z", "credit.expired", -2],
			// the cancel on 20 March dates the tier row (period end + 1 month); the cron on 20 April books it, on 15 April 18:00
			["2026-04-15T18:00:00Z", "credit.expired", -2],
		]);
		expect(
			events.filter(
				(event) => event.event_type === "credit.expiration_changed",
			),
		).toHaveLength(1);
	});
});

describe("credits-unpaid-lapse (decision 4, rules version 3)", () => {
	test("an unpaid cycle's row is dated, lapses once at the cycle end plus a month, and a renewal paid after it grants only the allowance", async () => {
		const events = await eventsOf("credits-unpaid-lapse");
		expect(creditLines(events)).toEqual([
			["2026-01-15T18:00:00Z", "credit.granted", 2],
			// the 2 carried on 15 February lapse at 15 March 11:00 MDT
			["2026-02-15T18:00:00.001Z", "credit.granted", 2],
			["2026-03-15T17:00:00Z", "credit.expired", -2],
			// the March invoice, paid on 20 April: its grant carries the instant a late renewal's reset has (the cycle's start)
			["2026-03-15T18:00:00.001Z", "credit.granted", 2],
			// the tier row's 2, dated on 16 March, lapse on 15 April 12:00 MDT: booked once (the cron ran twice)
			["2026-04-15T18:00:00Z", "credit.expired", -2],
		]);
		const dating = events.filter(
			(event) => event.event_type === "credit.expiration_changed",
		);
		expect(dating.map((event) => event.event_time)).toEqual([
			"2026-03-16T12:01:00Z",
		]);
		expect(dating[0]?.payload).toMatchObject({
			row_id: "ce_tier_visit_month",
			previous_expires_at: null,
			expires_at: Date.parse("2026-04-15T18:00:00Z"),
			refills_ended: false,
		});
		// the late payment emptied the lapsed row without booking it again or as an adjustment
		expect(
			events.filter((event) => event.event_type === "credit.adjusted"),
		).toEqual([]);
		expect(availAt(events, "2026-04-21T12:00:00Z")).toBe(2);
	});

	test("a renewal paid before the lapse date takes the dating back: the 2 left roll over and lapse as in any renewal", async () => {
		const events = await eventsOf("credits-unpaid-late-payment");
		expect(creditLines(events)).toEqual([
			["2026-01-15T18:00:00Z", "credit.granted", 2],
			["2026-02-15T18:00:00.001Z", "credit.granted", 2],
			["2026-03-15T17:00:00Z", "credit.expired", -2],
			// paid on 20 March: the 2 left roll over, 2 are granted
			["2026-03-15T18:00:00.001Z", "credit.granted", 2],
			["2026-04-15T18:00:00Z", "credit.expired", -2],
		]);
		expect(availAt(events, "2026-03-20T12:00:00Z")).toBe(4);
		expect(availAt(events, "2026-04-16T12:00:00Z")).toBe(2);
	});
});

describe("credits-gift-expiry (decision 5, giftSessionMonths null)", () => {
	test("a one-time add-on lapses after its 3 rollover months, a session gift with no rollover never does", async () => {
		expect(creditLines(await eventsOf("credits-gift-expiry"))).toEqual([
			["2026-01-15T18:00:00Z", "credit.granted", 1],
			["2026-01-15T19:00:00Z", "credit.granted", 1],
			// 15 January 11:00 MST + 3 months = 15 April 11:00 MDT = 17:00 UTC; the gift is not touched in 2028 either
			["2026-04-15T17:00:00Z", "credit.expired", -1],
		]);
	});
});

describe("credits-menu-version (decision 6)", () => {
	test("a member's renewals grant from their own version; a newcomer after the publish is on the new one", async () => {
		const events = await eventsOf("credits-menu-version");
		expect(
			creditLines(events).map(([, type, credits]) => [type, credits]),
		).toEqual([
			["credit.granted", 2],
			["credit.granted", 2],
			["credit.expired", -2],
			["credit.granted", 2],
		]);
		expect(creditLines(events, "fam_b2")).toEqual([
			["2026-02-20T18:00:00Z", "credit.granted", 3],
			["2026-03-20T18:00:00.001Z", "credit.granted", 3],
		]);
		const versions = (family: string) =>
			events
				.filter(
					(event) =>
						event.event_type === "credit.granted" &&
						event.key === `family:${family}`,
				)
				.map((event) => event.labels.menu_version);
		expect(versions(FAMILY)).toEqual(["1", "1", "1"]);
		expect(versions("fam_b2")).toEqual(["2", "2"]);
	});
});

describe("credits-adjust-never-expires (decision 7)", () => {
	test("a goodwill adjustment survives renewals and years of lapse crons; a correction takes the soonest expiry first", async () => {
		const events = await eventsOf("credits-adjust-never-expires");
		expect(creditLines(events)).toEqual([
			["2026-01-15T18:00:00Z", "credit.granted", 2],
			["2026-01-20T12:00:00Z", "credit.adjusted", 3],
			["2026-02-15T18:00:00.001Z", "credit.granted", 2],
			["2026-03-15T18:00:00Z", "credit.expired", -2],
			["2026-03-15T18:00:00.001Z", "credit.granted", 2],
			// the correction's 2 come from the rollover (soonest expiry), so the crons of April and a year on book nothing
			["2026-03-20T12:00:00Z", "credit.adjusted", -2],
		]);
		const adjusted = events.filter((e) => e.event_type === "credit.adjusted");
		expect(adjusted.map((event) => event.payload.reason)).toEqual([
			"goodwill",
			"correction",
		]);
	});
});

describe("credits-import-renewal", () => {
	test("the opening events, the seeded duplicate and the renewal agree with the family service's own lots at three instants", async () => {
		const events = await eventsOf("credits-import-renewal");
		expect(creditLines(events)).toEqual([
			// the import: January's 2 carried (they lapse where the family service dated them) and February's 1 left
			["2026-02-20T12:00:00Z", "credit.granted", 3],
			["2026-03-15T17:00:00Z", "credit.expired", -2],
			["2026-03-15T18:00:00.001Z", "credit.granted", 2],
			["2026-04-15T18:00:00Z", "credit.expired", -1],
		]);
		// the family service's lots, by its rules (the oracle): January and February as imported, then March's grant
		const bundle = await loadScenarioBundle(
			resolveBundleDirectory("credits-import-renewal"),
		);
		const imported = bundle.steps.find((step) => step.kind === "import");
		if (imported?.kind !== "import") throw new Error("no import step");
		const march = callerGrant({
			membership: imported.membership,
			menu: bundle.scenario.menu,
			invoice: {
				id: "in_new",
				reason: "subscription_cycle",
				periodStart: Date.parse("2026-03-15T18:00:00Z"),
				periodEnd: Date.parse("2026-04-15T18:00:00Z"),
				atMs: Date.parse("2026-03-15T18:00:00Z"),
			},
			existing: imported.lots,
		});
		const lots = [...imported.lots, ...march];
		for (const at of [
			"2026-02-20T12:00:00Z",
			"2026-03-15T18:05:00Z",
			"2026-04-16T12:00:00Z",
		])
			expect(availAt(events, at), at).toBe(
				callerAvail(
					lots.filter((lot) => lot.created_at <= Date.parse(at)),
					Date.parse(at),
				),
			);
	});
});

describe("credits-import-refund", () => {
	test("the seeded index finds the holder of a pre-import invoice and the refund takes its credits back (D8: no refund line)", async () => {
		const events = await eventsOf("credits-import-refund");
		expect(creditLines(events)).toEqual([
			["2026-02-01T12:00:00Z", "credit.granted", 2],
			["2026-02-05T12:00:00Z", "credit.adjusted", -2],
		]);
		expect(
			events.some((event) => event.event_type === "payment.refunded"),
		).toBe(false);
	});
});

describe("credits-import-rollover-trim (decision 1, owner ruling 2026-11-08)", () => {
	test("the first renewal after the import trims the imported rollover to the cap: 3 held where the family service's lots hold 5", async () => {
		const events = await eventsOf("credits-import-rollover-trim");
		expect(creditLines(events)).toEqual([
			// the import: January's 2 (a rollover) and February's 1 left on the row
			["2026-02-20T12:00:00Z", "credit.granted", 3],
			// 15 March: the 3 unused are cut to the cap of 1 (2 lost), 1 rolls over, 2 are granted
			["2026-03-15T18:00:00.001Z", "credit.expired", -2],
			["2026-03-15T18:00:00.001Z", "credit.granted", 2],
		]);
		const bundle = await loadScenarioBundle(
			resolveBundleDirectory("credits-import-rollover-trim"),
		);
		const imported = bundle.steps.find((step) => step.kind === "import");
		if (imported?.kind !== "import") throw new Error("no import step");
		const march = callerGrant({
			membership: imported.membership,
			menu: bundle.scenario.menu,
			invoice: {
				id: "in_new",
				reason: "subscription_cycle",
				periodStart: Date.parse("2026-03-15T18:00:00Z"),
				periodEnd: Date.parse("2026-04-15T18:00:00Z"),
				atMs: Date.parse("2026-03-15T18:00:00Z"),
			},
			existing: imported.lots,
		});
		const at = "2026-03-15T19:00:00Z";
		expect(availAt(events, at)).toBe(3);
		expect(callerAvail([...imported.lots, ...march], Date.parse(at))).toBe(5);
	});
});

describe("credits-import-refund-paid (D8 fixed: the import recorded the paid amount)", () => {
	test("a refund of a pre-import invoice takes the credits back and books payment.refunded once", async () => {
		const events = await eventsOf("credits-import-refund-paid");
		expect(creditLines(events)).toEqual([
			["2026-02-01T12:00:00Z", "credit.granted", 2],
			["2026-02-05T12:00:00Z", "credit.adjusted", -2],
		]);
		const refunds = events.filter(
			(event) => event.event_type === "payment.refunded",
		);
		expect(refunds.map((event) => event.payload.amount)).toEqual([26_000]);
		expect(refunds.map((event) => event.payload.invoice)).toEqual(["in_old1"]);
	});
});
