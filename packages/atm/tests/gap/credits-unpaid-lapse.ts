/**
 * D12 decision 4 for a cycle that ended unpaid (plan §13, item 7), one bundle for a late payment after the lapse and one
 * before it. Hand numbers only: the price list is fixtures/billing/grants/menu.json (Denver), Stripe's fee 2.9% + 30 cents.
 */

import {
	applied,
	FEE_SPARKLE_2,
	ms,
	SPARKLE_2,
	stripeOfPayments,
	tierInvoice,
	visits,
} from "../credits-engine-world.js";
import type { Case } from "../e2e-matrix.js";
import { FAMILY, SCHOOL } from "../handler-harness.js";

const JAN15 = "2026-01-15T18:00:00Z";
const FEB15 = "2026-02-15T18:00:00Z";
const MAR15 = "2026-03-15T18:00:00Z";
const APR15 = "2026-04-15T18:00:00Z";

const JAN = { start: ms(JAN15), end: ms(FEB15) };
const FEB = { start: ms(FEB15), end: ms(MAR15) };
const MAR = { start: ms(MAR15), end: ms(APR15) };

const sparkle2 = (
	id: string,
	at: number,
	reason: "subscription_create" | "subscription_cycle",
	cycle: { start: number; end: number },
	next?: { start: number; end: number },
) =>
	tierInvoice({
		id,
		at,
		reason,
		cycle,
		...(next ? { next } : {}),
		tier: "sparkle-2",
		amount: SPARKLE_2,
	});

const payments = (third: number) => [
	{ id: "in_1", amount: SPARKLE_2, fee: FEE_SPARKLE_2, at: ms(JAN15) },
	{ id: "in_2", amount: SPARKLE_2, fee: FEE_SPARKLE_2, at: ms(FEB15) },
	{ id: "in_3", amount: SPARKLE_2, fee: FEE_SPARKLE_2, at: third },
];

/** The job's first three steps on 16 March: the cron books the rollover that lapsed, then the unpaid cycle is dated, twice. */
const MAR16_JOB = ms("2026-03-16T12:00:00Z");
const unpaidJob = Array.from({ length: 2 }, (_, run) => ({
	kind: "unpaid" as const,
	at: MAR16_JOB + (run + 1) * 60_000,
	family: FAMILY,
	cycleEnd: ms(MAR15),
}));

export const CASES: Case[] = [
	{
		id: "credits-unpaid-lapse",
		title:
			"unpaid cycle lapse (decision 4, rules version 3): the cycle's tier row lapses at the cycle end plus the rollover month; a renewal paid after that grants the allowance and no lapsed credit comes back",
		path: "the lapse job's lapseUnpaidCycle, then the cron's credit.expired, then invoice.paid (subscription_cycle) after the lapse",
		policy: { rulesVersion: 3 },
		fees: { in_1: FEE_SPARKLE_2, in_2: FEE_SPARKLE_2, in_3: FEE_SPARKLE_2 },
		steps: [
			applied(
				ms(JAN15),
				sparkle2("in_1", ms(JAN15), "subscription_create", JAN),
			),
			applied(
				ms(FEB15),
				sparkle2("in_2", ms(FEB15), "subscription_cycle", JAN, FEB),
			),
			// no March payment. 16 March: the 2 rolled over on 15 February lapsed on 15 March at 11:00 MDT = 17:00 UTC
			{ kind: "lapse", at: MAR16_JOB, family: FAMILY, feature: "visit" },
			// the cycle ended on 15 March 18:00 unpaid: its row's 2 get expires_at = 15 April 12:00 MDT = 18:00 UTC; a second run dates nothing
			...unpaidJob,
			// 15 April 18:00 has passed: the cron books the 2, with that instant, once
			{
				kind: "lapse",
				at: ms("2026-04-16T12:00:00Z"),
				family: FAMILY,
				feature: "visit",
			},
			{
				kind: "lapse",
				at: ms("2026-04-16T12:00:00Z"),
				family: FAMILY,
				feature: "visit",
			},
			// the March invoice is paid on 20 April, after the lapse
			applied(
				ms("2026-04-20T12:00:00Z"),
				sparkle2(
					"in_3",
					ms("2026-04-20T12:00:00Z"),
					"subscription_cycle",
					FEB,
					MAR,
				),
			),
			// the cron after the late payment books nothing: the lapsed 2 were emptied by it, not carried
			{
				kind: "lapse",
				at: ms("2026-04-21T12:00:00Z"),
				family: FAMILY,
				feature: "visit",
			},
			{ kind: "ship", at: ms("2026-04-21T13:00:00Z") },
		],
		verdict: "OK",
		books: [
			{
				school: SCHOOL,
				hand: {
					"income:membership:sparkle-2": 3 * SPARKLE_2,
					fees: 3 * FEE_SPARKLE_2,
					stripe: 3 * (SPARKLE_2 - FEE_SPARKLE_2),
					net: 3 * (SPARKLE_2 - FEE_SPARKLE_2),
					[visits(FAMILY)]: 2,
				},
				stripe: stripeOfPayments(payments(ms("2026-04-20T12:00:00Z"))),
				reconcile: { "2026-01": [], "2026-02": [], "2026-04": [] },
			},
		],
		notes: [
			"decision 4, policy rulesVersion 3: a bs lot of an unpaid cycle lapses at the cycle's end plus the grant's rollover months. tfd dates the row with lapseUnpaidCycle (credit.expiration_changed, refills not ended) and the cron's recordLapse books it",
			"15 February: 2 rolled over, 2 granted. No March payment. 16 March: the rolled 2 lapsed at 15 March 11:00 MDT (17:00 UTC) and are booked; the job then dates the tier row's 2 at 15 March 18:00 UTC + 1 month in Denver = 15 April 18:00 UTC; the second run finds the cycle dated and does nothing",
			"16 April: the cron books the 2 with the instant 15 April 18:00 UTC; the second run books nothing (the same idem)",
			"20 April: the March invoice is paid. The row's dating has passed, so the renewal empties the row (the lapse was booked: no second expiry, no credit.adjusted), clears the dating and grants 2 at the March cycle start (the instant a late renewal's reset has always had, 15 March 18:00:00.001 UTC). Credits granted 6, expired 4, 2 left",
			"money: 3 x 260.00, fees 3 x 7.84; the March payment is booked in April",
		],
	},
	{
		id: "credits-unpaid-late-payment",
		title:
			"unpaid cycle, paid late but before the lapse (decision 4, rules version 3): the dating is undone and the renewal rolls the 2 over as it would have",
		path: "the lapse job's lapseUnpaidCycle, then invoice.paid (subscription_cycle) before the lapse date, then the cron's credit.expired",
		policy: { rulesVersion: 3 },
		fees: { in_1: FEE_SPARKLE_2, in_2: FEE_SPARKLE_2, in_3: FEE_SPARKLE_2 },
		steps: [
			applied(
				ms(JAN15),
				sparkle2("in_1", ms(JAN15), "subscription_create", JAN),
			),
			applied(
				ms(FEB15),
				sparkle2("in_2", ms(FEB15), "subscription_cycle", JAN, FEB),
			),
			{ kind: "lapse", at: MAR16_JOB, family: FAMILY, feature: "visit" },
			...unpaidJob,
			// paid on 20 March, 26 days before the 15 April lapse
			applied(
				ms("2026-03-20T12:00:00Z"),
				sparkle2(
					"in_3",
					ms("2026-03-20T12:00:00Z"),
					"subscription_cycle",
					FEB,
					MAR,
				),
			),
			// 16 April: the 2 rolled over at the March cycle's start lapse at 15 April 18:00 UTC, as in any renewal
			{
				kind: "lapse",
				at: ms("2026-04-16T12:00:00Z"),
				family: FAMILY,
				feature: "visit",
			},
			{ kind: "ship", at: ms("2026-04-16T13:00:00Z") },
		],
		verdict: "OK",
		books: [
			{
				school: SCHOOL,
				hand: {
					"income:membership:sparkle-2": 3 * SPARKLE_2,
					fees: 3 * FEE_SPARKLE_2,
					stripe: 3 * (SPARKLE_2 - FEE_SPARKLE_2),
					net: 3 * (SPARKLE_2 - FEE_SPARKLE_2),
					[visits(FAMILY)]: 2,
				},
				stripe: stripeOfPayments(payments(ms("2026-03-20T12:00:00Z"))),
				reconcile: { "2026-01": [], "2026-02": [], "2026-03": [] },
			},
		],
		notes: [
			"same story to 16 March: the unpaid cycle's row is dated 15 April 18:00 UTC",
			"20 March: the March invoice is paid before that date. The renewal clears the dating (no event: an expiry cleared to none ends nothing), the 2 left roll over to expire 15 April 18:00 UTC, 2 are granted: 4",
			"16 April: the cron books the rolled 2 (the instant 15 April 18:00 UTC); 2 left. Credits granted 6, expired 4",
		],
	},
];
