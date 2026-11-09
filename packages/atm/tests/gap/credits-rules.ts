/**
 * D12 stage 1 (T9), the rule decisions of `plans/credits-engine/decisions.md`, one bundle each. Hand numbers only: the price
 * list is fixtures/billing/grants/menu.json (Denver), Stripe's fee 2.9% + 30 cents, rounded.
 */

import type { Menu } from "../../src/billing/types.js";
import {
	applied,
	FEE_SPARKLE_1,
	FEE_SPARKLE_2,
	ms,
	SPARKLE_1,
	SPARKLE_2,
	stripeOfPayments,
	tierInvoice,
	visits,
} from "../credits-engine-world.js";
import { addonLine, invoice, subscriptionOf, tierLine } from "../e2e-events.js";
import type { Case } from "../e2e-matrix.js";
import { menu as baseMenu, FAMILY, SCHOOL } from "../handler-harness.js";

const JAN15 = "2026-01-15T18:00:00Z";
const FEB15 = "2026-02-15T18:00:00Z";
const MAR15 = "2026-03-15T18:00:00Z";
const APR15 = "2026-04-15T18:00:00Z";

/** Sparkle-2 grants 2 visits a month and may carry only 1 over to the next month: the cap of decision 1. */
const cappedMenu: Menu = {
	...baseMenu,
	tiers: baseMenu.tiers.map((tier) =>
		tier.id === "sparkle-2"
			? {
					...tier,
					grants: tier.grants.map((grant) => ({
						...grant,
						rollover: { max: 1, months: 1 },
					})),
				}
			: tier,
	),
};

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

const PACK = 9_000;
const FEE_PACK = 291; // 9,000 x 2.9% = 261 + 30
const GIFT_VISIT = 13_000;
const FEE_GIFT_VISIT = 407;
const JAN25 = "2026-01-25T18:00:00Z";
/** Ten of the cycle's 31 days are used, so 21 of 31 are left: the proration of the upgrade invoice. */
const UPGRADE_CREDIT = -8_806; // -13,000 x 21/31 = -8,806.45
const UPGRADE_CHARGE = 17_613; // 26,000 x 21/31 = 17,612.9
const UPGRADE_PAID = UPGRADE_CREDIT + UPGRADE_CHARGE;
const FEE_UPGRADE = 285; // 8,807 x 2.9% = 255.4 -> 255, + 30

export const CASES: Case[] = [
	{
		id: "credits-rollover-cap",
		title:
			"rollover cap (decision 1): the leftover above the menu's cap is lost at each renewal",
		path: "invoice.paid (subscription_cycle) resets, the cap applies",
		menu: cappedMenu,
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
			{ kind: "lapse", at: ms(MAR15), family: FAMILY, feature: "visit" },
			applied(
				ms(MAR15) + 5 * 60_000,
				sparkle2(
					"in_3",
					ms(MAR15) + 5 * 60_000,
					"subscription_cycle",
					FEB,
					MAR,
				),
			),
			{ kind: "ship", at: ms(MAR15) + 3_600_000 },
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
					[visits(FAMILY)]: 3,
				},
				stripe: stripeOfPayments([
					{ id: "in_1", amount: SPARKLE_2, fee: FEE_SPARKLE_2, at: ms(JAN15) },
					{ id: "in_2", amount: SPARKLE_2, fee: FEE_SPARKLE_2, at: ms(FEB15) },
					{
						id: "in_3",
						amount: SPARKLE_2,
						fee: FEE_SPARKLE_2,
						at: ms(MAR15) + 5 * 60_000,
					},
				]),
				reconcile: { "2026-01": [], "2026-02": [], "2026-03": [] },
			},
		],
		notes: [
			"decision 1: sparkle-2 grants 2 visits a month and the menu lets 1 be carried for 1 month; the cap applies at every renewal",
			"15 February: the 2 unused are cut to the cap, 1 is lost (credit.expired -1) and 1 rolls over; 2 are granted: 3. 15 March 18:00 the cron expires the rolled visit (2 left); the renewal five minutes later loses 1 more of the 2 unused, rolls 1 and grants 2: 3",
			"credits granted 6, expired 3 (the cap twice, the lapsed rollover once), 3 left; money: 3 x 260.00 = 780.00, fees 3 x 7.84 = 23.52 (26,000 x 2.9% = 754 + 30), net and Stripe's balance 756.48",
			"not here: the grandfathered cycle. The reset trims an imported rollover to the cap along with the new one (plan §13, item 8), so no bundle pins 'the first renewal after the import takes nothing'",
		],
	},
	{
		id: "credits-immediate-upgrade",
		title:
			"immediate upgrade (decision 2): the new tier's extra credits are granted when the upgrade invoice is paid",
		path: "invoice.paid (subscription_update, two proration lines) then a renewal on the new tier",
		fees: {
			in_1: FEE_SPARKLE_1,
			in_up: FEE_UPGRADE,
			in_2: FEE_SPARKLE_2,
		},
		steps: [
			applied(
				ms(JAN15),
				tierInvoice({
					id: "in_1",
					at: ms(JAN15),
					reason: "subscription_create",
					cycle: JAN,
					tier: "sparkle-1",
					amount: SPARKLE_1,
				}),
			),
			applied(
				ms(JAN25),
				invoice({
					id: "in_up",
					at: ms(JAN25),
					reason: "subscription_update",
					start: ms(JAN15),
					end: ms(JAN25),
					lines: [
						tierLine("sparkle-1", {
							amount: UPGRADE_CREDIT,
							proration: true,
							periodStart: ms(JAN25),
							periodEnd: ms(FEB15),
						}),
						tierLine("sparkle-2", {
							amount: UPGRADE_CHARGE,
							proration: true,
							periodStart: ms(JAN25),
							periodEnd: ms(FEB15),
						}),
					],
				}),
			),
			applied(
				ms(FEB15),
				tierInvoice({
					id: "in_2",
					at: ms(FEB15),
					reason: "subscription_cycle",
					cycle: JAN,
					next: FEB,
					tier: "sparkle-2",
					amount: SPARKLE_2,
				}),
			),
			{ kind: "ship", at: ms(FEB15) + 3_600_000 },
		],
		verdict: "OK",
		books: [
			{
				school: SCHOOL,
				hand: {
					"income:membership:sparkle-1": SPARKLE_1,
					"income:membership:sparkle-2": UPGRADE_PAID + SPARKLE_2,
					fees: FEE_SPARKLE_1 + FEE_UPGRADE + FEE_SPARKLE_2,
					stripe:
						SPARKLE_1 +
						UPGRADE_PAID +
						SPARKLE_2 -
						(FEE_SPARKLE_1 + FEE_UPGRADE + FEE_SPARKLE_2),
					net:
						SPARKLE_1 +
						UPGRADE_PAID +
						SPARKLE_2 -
						(FEE_SPARKLE_1 + FEE_UPGRADE + FEE_SPARKLE_2),
					[visits(FAMILY)]: 4,
				},
				stripe: stripeOfPayments([
					{ id: "in_1", amount: SPARKLE_1, fee: FEE_SPARKLE_1, at: ms(JAN15) },
					{
						id: "in_up",
						amount: UPGRADE_PAID,
						fee: FEE_UPGRADE,
						at: ms(JAN25),
					},
					{ id: "in_2", amount: SPARKLE_2, fee: FEE_SPARKLE_2, at: ms(FEB15) },
				]),
				reconcile: { "2026-01": [], "2026-02": [] },
			},
		],
		notes: [
			"decision 2: sparkle-1 (13,000, 1 visit) to sparkle-2 (26,000, 2 visits) on 25 January, 21 of the cycle's 31 days left",
			"credit line -13,000 x 21/31 = -8,806 (8,806.45), charge 26,000 x 21/31 = 17,613 (17,612.9): the member pays 8,807; fee 8,807 x 2.9% = 255 + 30 = 285; the upgrade invoice is booked under the new tier",
			"credits: 1 on 15 January; the upgrade grants the 1 extra visit at once, 1 x 21/31 rounded up = 1: 2; the renewal on 15 February carries the 2 over (cap 2) and grants 2: 4",
			"income sparkle-1 130.00, sparkle-2 88.07 + 260.00 = 348.07; fees 4.07 + 2.85 + 7.84 = 14.76; cash 463.31",
		],
	},
	{
		id: "credits-zoned-expiry",
		title:
			"menu-zone expiry across a DST change (decision 3, rules version 2): a rollover lapses at the same Denver wall-clock time a month on",
		path: "invoice.paid (subscription_cycle) with policy.rulesVersion 2 + the cron's credit.expired",
		policy: { rulesVersion: 2 },
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
			// Denver went forward on 8 March: the 2 visits rolled over on 15 February (11:00 MST) lapse on 15 March at 11:00 MDT,
			// 17:00 UTC, an hour before the cycle boundary. Rules version 1 would lapse them at 18:00 UTC.
			{
				kind: "lapse",
				at: ms("2026-03-15T17:30:00Z"),
				family: FAMILY,
				feature: "visit",
			},
			applied(
				ms(MAR15),
				sparkle2("in_3", ms(MAR15), "subscription_cycle", FEB, MAR),
			),
			// the 2 rolled over on 15 March (11:00... 12:00 MDT) lapse on 15 April at 12:00 MDT = 18:00 UTC; at 17:30 UTC they still hold
			{
				kind: "lapse",
				at: ms("2026-04-15T17:30:00Z"),
				family: FAMILY,
				feature: "visit",
			},
			{
				kind: "lapse",
				at: ms("2026-04-15T18:30:00Z"),
				family: FAMILY,
				feature: "visit",
			},
			{ kind: "ship", at: ms("2026-04-15T19:30:00Z") },
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
				stripe: stripeOfPayments([
					{ id: "in_1", amount: SPARKLE_2, fee: FEE_SPARKLE_2, at: ms(JAN15) },
					{ id: "in_2", amount: SPARKLE_2, fee: FEE_SPARKLE_2, at: ms(FEB15) },
					{ id: "in_3", amount: SPARKLE_2, fee: FEE_SPARKLE_2, at: ms(MAR15) },
				]),
				reconcile: { "2026-01": [], "2026-02": [], "2026-03": [] },
			},
		],
		notes: [
			"decision 3, policy rulesVersion 2: a rollover lapses on the menu's calendar (Denver). Denver went forward on 8 March",
			"the visits rolled over on 15 February (11:00 MST) lapse on 15 March at 11:00 MDT = 17:00 UTC, an hour before the cycle boundary (rules version 1: 18:00 UTC); the cron at 17:30 UTC books them with that instant",
			"the visits rolled over on 15 March (12:00 MDT) lapse on 15 April at 12:00 MDT = 18:00 UTC: the cron at 17:30 UTC books nothing, the one at 18:30 books 2. 2 are left (the refilling row)",
			"credits granted 6, expired 4, 2 left; money: 3 x 260.00, fees 3 x 7.84",
		],
	},
	{
		id: "credits-lapse",
		title:
			"lapse (decision 4, recordLapse): the cron books a rollover whose time has passed once; a tier row of an unpaid cycle keeps its balance until the subscription ends",
		path: "the cron's credit.expired; customer.subscription.deleted dates the refilling row",
		fees: { in_1: FEE_SPARKLE_2, in_2: FEE_SPARKLE_2 },
		steps: [
			applied(
				ms(JAN15),
				sparkle2("in_1", ms(JAN15), "subscription_create", JAN),
			),
			applied(
				ms(FEB15),
				sparkle2("in_2", ms(FEB15), "subscription_cycle", JAN, FEB),
			),
			// no March payment. 16 March: the 2 rolled over on 15 February lapsed at 15 March 18:00; the tier row's 2 stay (no expiry)
			{
				kind: "lapse",
				at: ms("2026-03-16T12:00:00Z"),
				family: FAMILY,
				feature: "visit",
			},
			// the cron runs again: nothing new
			{
				kind: "lapse",
				at: ms("2026-03-16T12:00:00Z"),
				family: FAMILY,
				feature: "visit",
			},
			{
				at: ms("2026-03-20T12:00:00Z"),
				event: subscriptionOf({
					type: "customer.subscription.deleted",
					id: "evt_del",
					status: "canceled",
					tierId: "sparkle-2",
					start: ms(FEB15),
					end: ms(MAR15),
					at: ms("2026-03-20T12:00:00Z"),
				}),
				answer: [200, "applied"],
			},
			{
				kind: "lapse",
				at: ms("2026-04-20T12:00:00Z"),
				family: FAMILY,
				feature: "visit",
			},
			{ kind: "ship", at: ms("2026-04-20T13:00:00Z") },
		],
		verdict: "OK",
		books: [
			{
				school: SCHOOL,
				hand: {
					"income:membership:sparkle-2": 2 * SPARKLE_2,
					fees: 2 * FEE_SPARKLE_2,
					stripe: 2 * (SPARKLE_2 - FEE_SPARKLE_2),
					net: 2 * (SPARKLE_2 - FEE_SPARKLE_2),
					[visits(FAMILY)]: 0,
				},
				stripe: stripeOfPayments([
					{ id: "in_1", amount: SPARKLE_2, fee: FEE_SPARKLE_2, at: ms(JAN15) },
					{ id: "in_2", amount: SPARKLE_2, fee: FEE_SPARKLE_2, at: ms(FEB15) },
				]),
				reconcile: { "2026-01": [], "2026-02": [] },
			},
		],
		notes: [
			"decision 4: a job calls recordLapse (the cron's lapse step here). It books a row whose expires_at has passed, once",
			"15 February: 2 rolled over, 2 granted. No March payment. 16 March: the 2 rolled over lapsed at 15 March 18:00 and are booked with that instant (2 left); the tier row's 2 have no expires_at (the cycle ended unpaid) and are not booked; the second run of the cron books nothing",
			"20 March the subscription is deleted: the tier row gets expires_at = the cycle end (15 March 18:00) + 1 rollover month = 15 April 18:00 (credit.expiration_changed); the cron on 20 April books its 2 with that instant. 0 left",
			"without a cancel an unpaid cycle's tier row stays undated under rules versions 1 and 2, as here; under rules version 3 the lapse job dates it (credits-unpaid-lapse, plan §13 item 7)",
		],
	},
	{
		id: "credits-gift-expiry",
		title:
			"gift and one-time expiry (decision 5, giftSessionMonths null): a one-time add-on lasts its grant's 3 rollover months, a session gift with no rollover never expires",
		path: "invoice.paid (one-time add-on lines) + the cron's credit.expired",
		policy: { rulesVersion: 2, giftSessionMonths: null },
		fees: { in_pack: FEE_PACK, in_gift: FEE_GIFT_VISIT },
		steps: [
			applied(
				ms(JAN15),
				invoice({
					id: "in_pack",
					at: ms(JAN15),
					reason: "manual",
					subscription: null,
					lines: [addonLine("pack", { amount: PACK })],
				}),
			),
			applied(
				ms(JAN15) + 3_600_000,
				invoice({
					id: "in_gift",
					at: ms(JAN15) + 3_600_000,
					reason: "manual",
					subscription: null,
					lines: [addonLine("gift-visit", { amount: GIFT_VISIT })],
				}),
			),
			// 14 April: the pack's visit has 1 more day (three months from 15 January 11:00 MST is 15 April 11:00 MDT)
			{
				kind: "lapse",
				at: ms("2026-04-14T12:00:00Z"),
				family: FAMILY,
				feature: "visit",
			},
			// 15 April 17:30 UTC: past 11:00 MDT. The gift is not touched, now or years on.
			{
				kind: "lapse",
				at: ms("2026-04-15T17:30:00Z"),
				family: FAMILY,
				feature: "visit",
			},
			{
				kind: "lapse",
				at: ms("2028-01-15T18:00:00Z"),
				family: FAMILY,
				feature: "visit",
			},
			{ kind: "ship", at: ms("2028-01-15T19:00:00Z") },
		],
		verdict: "OK",
		books: [
			{
				school: SCHOOL,
				hand: {
					"income:addon:pack": PACK,
					"income:addon:gift-visit": GIFT_VISIT,
					fees: FEE_PACK + FEE_GIFT_VISIT,
					stripe: PACK + GIFT_VISIT - (FEE_PACK + FEE_GIFT_VISIT),
					net: PACK + GIFT_VISIT - (FEE_PACK + FEE_GIFT_VISIT),
					[visits(FAMILY)]: 1,
				},
				stripe: stripeOfPayments([
					{ id: "in_pack", amount: PACK, fee: FEE_PACK, at: ms(JAN15) },
					{
						id: "in_gift",
						amount: GIFT_VISIT,
						fee: FEE_GIFT_VISIT,
						at: ms(JAN15) + 3_600_000,
					},
				]),
				reconcile: { "2026-01": [] },
			},
		],
		notes: [
			"decision 5, policy rulesVersion 2 and giftSessionMonths null: a one-time add-on lasts its grant's rollover months, a session gift whose grant has none never expires",
			"pack (90.00, 1 visit, 3 rollover months) paid 15 January 11:00 MST: lapses 15 April 11:00 MDT = 17:00 UTC (the cron at 12:00 UTC on 14 April books nothing, the one at 17:30 UTC on the 15th books 1). gift-visit (130.00, 1 visit, no rollover) is never booked, in April 2026 or January 2028",
			"money: 90.00 + 130.00 = 220.00; fees 2.91 (9,000 x 2.9% = 261 + 30) + 4.07; cash 213.02. 1 visit left (the gift)",
		],
	},
	{
		id: "credits-adjust-never-expires",
		title:
			"never-expiring adjustment (decision 7): a positive admin adjustment survives renewals and lapses; a correction takes the soonest expiry first",
		path: "adjustCredits (goodwill, correction) beside invoice.paid renewals and the cron's credit.expired",
		fees: { in_1: FEE_SPARKLE_2, in_2: FEE_SPARKLE_2, in_3: FEE_SPARKLE_2 },
		steps: [
			applied(
				ms(JAN15),
				sparkle2("in_1", ms(JAN15), "subscription_create", JAN),
			),
			{
				kind: "adjust",
				at: ms("2026-01-20T12:00:00Z"),
				family: FAMILY,
				commandId: "adj_goodwill",
				adjustKind: "goodwill",
				feature: "visit",
				credits: 3,
			},
			applied(
				ms(FEB15),
				sparkle2("in_2", ms(FEB15), "subscription_cycle", JAN, FEB),
			),
			{ kind: "lapse", at: ms(MAR15), family: FAMILY, feature: "visit" },
			applied(
				ms(MAR15) + 5 * 60_000,
				sparkle2(
					"in_3",
					ms(MAR15) + 5 * 60_000,
					"subscription_cycle",
					FEB,
					MAR,
				),
			),
			{
				kind: "adjust",
				at: ms("2026-03-20T12:00:00Z"),
				family: FAMILY,
				commandId: "adj_correction",
				adjustKind: "correction",
				feature: "visit",
				credits: -2,
			},
			{
				kind: "lapse",
				at: ms("2026-04-20T12:00:00Z"),
				family: FAMILY,
				feature: "visit",
			},
			{
				kind: "lapse",
				at: ms("2027-04-20T12:00:00Z"),
				family: FAMILY,
				feature: "visit",
			},
			{ kind: "ship", at: ms("2027-04-20T13:00:00Z") },
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
					[visits(FAMILY)]: 5,
				},
				stripe: stripeOfPayments([
					{ id: "in_1", amount: SPARKLE_2, fee: FEE_SPARKLE_2, at: ms(JAN15) },
					{ id: "in_2", amount: SPARKLE_2, fee: FEE_SPARKLE_2, at: ms(FEB15) },
					{
						id: "in_3",
						amount: SPARKLE_2,
						fee: FEE_SPARKLE_2,
						at: ms(MAR15) + 5 * 60_000,
					},
				]),
				reconcile: { "2026-01": [], "2026-02": [], "2026-03": [] },
			},
		],
		notes: [
			"decision 7: adjustCredits. A goodwill adjustment of 3 visits on 20 January is a row of its own that never refills and never expires",
			"A pays 15 January (2), 15 February (2 rolled + 2 granted), 15 March (the cron expires the rolled 2 at 18:00; the renewal rolls 2 and grants 2): refilling 2, rolled 2, adjustment 3 = 7. The correction of -2 on 20 March takes the soonest expiry first, the rolled 2 (not the adjustment): 5",
			"the crons of 20 April 2026 and 20 April 2027 book nothing: the rolled row is empty and the adjustment has no expiry. 5 left",
			"money: 3 x 260.00, fees 3 x 7.84; an adjustment moves no money",
		],
	},
];
