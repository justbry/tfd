/**
 * D12 stage 1 (T9), the importer and the per-member menu version of `plans/credits-engine/decisions.md`. Hand numbers
 * only. The caller's lots are what the family service's own rules write (`tests/caller-lots.ts`, ported by hand from
 * family-service `grant.ts`), so the importer is checked against an oracle that does not share its code.
 */

import type { Menu } from "../../src/billing/types.js";
import { paymentIntentOf } from "../../src/scenario/stripe-events.js";
import type { CallerMembershipRow } from "../../src/types.js";
import { callerGrant } from "../caller-lots.js";
import {
	applied,
	FEE_SPARKLE_2,
	ms,
	SPARKLE_2,
	stripeOfPayments,
	tierInvoice,
	visits,
} from "../credits-engine-world.js";
import { refundOf } from "../e2e-events.js";
import {
	type Case,
	stripeBalance,
	stripeInvoice,
	stripeRefund,
} from "../e2e-matrix.js";
import { menu as baseMenu, FAMILY, SCHOOL } from "../handler-harness.js";

const JAN15 = "2026-01-15T18:00:00Z";
const FEB15 = "2026-02-15T18:00:00Z";
const MAR15 = "2026-03-15T18:00:00Z";
const APR15 = "2026-04-15T18:00:00Z";
const JAN = { start: ms(JAN15), end: ms(FEB15) };
const FEB = { start: ms(FEB15), end: ms(MAR15) };
const MAR = { start: ms(MAR15), end: ms(APR15) };

const seconds = (atMs: number) => Math.floor(atMs / 1000);

/** The B4 Uni membership row of sparkle-2 paid monthly: `menuVersion` is the menu version it bought on. */
const membership = (o: {
	menuVersion: number;
	periodEnd: number;
	subscription?: string;
}): CallerMembershipRow => ({
	id: "mem_1",
	school_id: SCHOOL,
	family_id: FAMILY,
	profile_id: null,
	tier_id: "sparkle-2",
	interval: "month",
	addon_ids: "",
	menu_version: o.menuVersion,
	stripe_customer_id: "cus_SYNTH_0001",
	quantity: 1,
	stripe_subscription_id: o.subscription ?? "sub_1",
	status: "active",
	current_period_end: seconds(o.periodEnd),
	cancel_at_period_end: 0,
	revision: 1,
	stripe_event_at: seconds(ms(JAN15)),
	created_at: seconds(ms(JAN15)),
	updated_at: seconds(ms(JAN15)),
});

const refs = (invoiceId: string) => ({
	invoiceId,
	paymentRefs: [paymentIntentOf(invoiceId), `ch_${invoiceId}`],
});

/** Sparkle-2 grants 3 visits a month (carry 3) in version 2 of the menu; version 1 grants 2 (carry 2). */
const menuV2: Menu = {
	...baseMenu,
	tiers: baseMenu.tiers.map((tier) =>
		tier.id === "sparkle-2"
			? {
					...tier,
					grants: tier.grants.map((grant) => ({
						...grant,
						amount: 3,
						rollover: { max: 3, months: 1 },
					})),
				}
			: tier,
	),
};

const FAMILY_B = "fam_b2";
const MEMBER_A_CYCLE_3 = { start: ms(MAR15), end: ms(APR15) };
const B_JOIN = ms("2026-02-20T18:00:00Z");
const B_CYCLE_1 = { start: B_JOIN, end: ms("2026-03-20T18:00:00Z") };
const B_CYCLE_2 = {
	start: ms("2026-03-20T18:00:00Z"),
	end: ms("2026-04-20T18:00:00Z"),
};

/** The member's lots as the family service wrote them: the January and February grants, February's with one visit spent. */
const importedLots = (menu: Menu) => {
	const member = membership({ menuVersion: 1, periodEnd: ms(MAR15) });
	const january = callerGrant({
		membership: member,
		menu,
		invoice: {
			id: "in_old1",
			reason: "subscription_create",
			periodStart: ms(JAN15),
			periodEnd: ms(FEB15),
			atMs: ms(JAN15),
		},
		existing: [],
	});
	const february = callerGrant({
		membership: member,
		menu,
		invoice: {
			id: "in_old2",
			reason: "subscription_cycle",
			periodStart: ms(FEB15),
			periodEnd: ms(MAR15),
			atMs: ms(FEB15),
		},
		existing: january,
	}).map((lot) => ({ ...lot, balance: 1 }));
	return { member, lots: [...january, ...february] };
};

const IMPORT_AT = ms("2026-02-20T12:00:00Z");

export const CASES: Case[] = [
	{
		id: "credits-menu-version",
		title:
			"per-member menu version (decision 6): a member stays on the menu version they bought after the school publishes a new one; a newcomer is on the new one",
		path: "invoice.paid (subscription_cycle) decided per holder against the member's own menu version",
		menus: { "1": baseMenu, "2": menuV2 },
		fees: {
			in_a1: FEE_SPARKLE_2,
			in_a2: FEE_SPARKLE_2,
			in_b1: FEE_SPARKLE_2,
			in_a3: FEE_SPARKLE_2,
			in_b2: FEE_SPARKLE_2,
		},
		steps: [
			applied(
				ms(JAN15),
				tierInvoice({
					id: "in_a1",
					at: ms(JAN15),
					reason: "subscription_create",
					cycle: JAN,
					tier: "sparkle-2",
					amount: SPARKLE_2,
				}),
			),
			// the school publishes version 2 (3 visits a month for sparkle-2)
			{ kind: "publish", at: ms("2026-02-01T12:00:00Z"), menuVersion: "2" },
			applied(
				ms(FEB15),
				tierInvoice({
					id: "in_a2",
					at: ms(FEB15),
					reason: "subscription_cycle",
					cycle: JAN,
					next: FEB,
					tier: "sparkle-2",
					amount: SPARKLE_2,
				}),
			),
			applied(
				B_JOIN,
				tierInvoice({
					id: "in_b1",
					at: B_JOIN,
					reason: "subscription_create",
					cycle: B_CYCLE_1,
					tier: "sparkle-2",
					amount: SPARKLE_2,
					family: FAMILY_B,
					subscription: "sub_b",
				}),
			),
			{ kind: "lapse", at: ms(MAR15), family: FAMILY, feature: "visit" },
			applied(
				ms(MAR15) + 5 * 60_000,
				tierInvoice({
					id: "in_a3",
					at: ms(MAR15) + 5 * 60_000,
					reason: "subscription_cycle",
					cycle: FEB,
					next: MEMBER_A_CYCLE_3,
					tier: "sparkle-2",
					amount: SPARKLE_2,
				}),
			),
			applied(
				B_CYCLE_2.start,
				tierInvoice({
					id: "in_b2",
					at: B_CYCLE_2.start,
					reason: "subscription_cycle",
					cycle: B_CYCLE_1,
					next: B_CYCLE_2,
					tier: "sparkle-2",
					amount: SPARKLE_2,
					family: FAMILY_B,
					subscription: "sub_b",
				}),
			),
			{ kind: "ship", at: ms("2026-03-21T12:00:00Z") },
		],
		verdict: "OK",
		books: [
			{
				school: SCHOOL,
				hand: {
					"income:membership:sparkle-2": 5 * SPARKLE_2,
					fees: 5 * FEE_SPARKLE_2,
					stripe: 5 * (SPARKLE_2 - FEE_SPARKLE_2),
					net: 5 * (SPARKLE_2 - FEE_SPARKLE_2),
					// A (version 1, 2 a month, carry 2): 2; 2 rolled + 2 = 4; the 2 rolled lapse at 15 March, then 2 rolled + 2 = 4
					[visits(FAMILY)]: 4,
					// B (version 2, 3 a month, carry 3): 3; 3 rolled + 3 = 6
					[visits(FAMILY_B)]: 6,
				},
				stripe: stripeOfPayments([
					{ id: "in_a1", amount: SPARKLE_2, fee: FEE_SPARKLE_2, at: ms(JAN15) },
					{ id: "in_a2", amount: SPARKLE_2, fee: FEE_SPARKLE_2, at: ms(FEB15) },
					{ id: "in_b1", amount: SPARKLE_2, fee: FEE_SPARKLE_2, at: B_JOIN },
					{
						id: "in_a3",
						amount: SPARKLE_2,
						fee: FEE_SPARKLE_2,
						at: ms(MAR15) + 5 * 60_000,
					},
					{
						id: "in_b2",
						amount: SPARKLE_2,
						fee: FEE_SPARKLE_2,
						at: B_CYCLE_2.start,
					},
				]),
				reconcile: { "2026-01": [], "2026-02": [], "2026-03": [] },
			},
		],
		notes: [
			"decision 6: the school publishes menu version 2 on 1 February (sparkle-2: 3 visits a month, carry 3, the same price). Member A bought on version 1 (2 a month, carry 2) and stays on it; member B joins on 20 February and is pinned to version 2",
			"A: 2 on 15 January; 15 February 2 rolled + 2 granted: 4 (not 3 granted); 15 March 18:00 the cron expires the rolled 2, the renewal five minutes later rolls 2 and grants 2: 4. B: 3 on 20 February; 20 March 3 rolled + 3 granted: 6",
			"each credit.granted is labelled with the version it ran under (A 1, B 2). The books replay holder by holder, each under its own version's catalog: one catalog cannot decide members on different versions",
			"money: 5 x 260.00 = 1,300.00, fees 5 x 7.84 = 39.20, cash 1,260.80",
		],
	},
	{
		id: "credits-import-renewal",
		title:
			"import then renewal: an imported member's rollover lapses where the family service dated it, and the renewal rolls the rest over and grants from the member's own menu version",
		path: "grantsStateFromCallerRows + opening events + seeded claims, then invoice.paid (subscription_cycle)",
		policy: { rulesVersion: 2 },
		menus: { "1": baseMenu },
		fees: { in_new: FEE_SPARKLE_2 },
		steps: [
			(() => {
				const { member, lots } = importedLots(baseMenu);
				return {
					kind: "import" as const,
					at: IMPORT_AT,
					membership: member,
					lots,
					eventIds: ["evt_in_old1", "evt_in_old2"],
					invoices: [refs("in_old1"), refs("in_old2")],
				};
			})(),
			// Stripe sends the February invoice's event again to the new endpoint: the caller finished it, so it is a duplicate
			{
				at: ms("2026-02-20T13:00:00Z"),
				event: tierInvoice({
					id: "in_old2",
					at: ms(FEB15),
					reason: "subscription_cycle",
					cycle: JAN,
					next: FEB,
					tier: "sparkle-2",
					amount: SPARKLE_2,
				}),
				answer: [200, "duplicate"],
			},
			// 15 March 11:00 MDT (17:00 UTC): the January grant, kept as February's rollover, lapses where the family service dated it
			{
				kind: "lapse",
				at: ms("2026-03-15T17:30:00Z"),
				family: FAMILY,
				feature: "visit",
			},
			applied(
				ms(MAR15),
				tierInvoice({
					id: "in_new",
					at: ms(MAR15),
					reason: "subscription_cycle",
					cycle: FEB,
					next: MAR,
					tier: "sparkle-2",
					amount: SPARKLE_2,
				}),
			),
			// the visit rolled over on 15 March lapses on 15 May at 12:00 MDT
			{
				kind: "lapse",
				at: ms("2026-05-16T12:00:00Z"),
				family: FAMILY,
				feature: "visit",
			},
			{ kind: "ship", at: ms("2026-05-16T13:00:00Z") },
		],
		verdict: "OK",
		books: [
			{
				school: SCHOOL,
				hand: {
					"income:membership:sparkle-2": SPARKLE_2,
					fees: FEE_SPARKLE_2,
					stripe: SPARKLE_2 - FEE_SPARKLE_2,
					net: SPARKLE_2 - FEE_SPARKLE_2,
					[visits(FAMILY)]: 2,
				},
				stripe: stripeOfPayments([
					{
						id: "in_new",
						amount: SPARKLE_2,
						fee: FEE_SPARKLE_2,
						at: ms(MAR15),
					},
				]),
				reconcile: { "2026-03": [] },
			},
		],
		notes: [
			"the family service imports a sparkle-2 member (rules version 2) on 20 February: its lots as its own rules write them (tests/caller-lots.ts): January's 2 (dated to lapse 15 March 11:00 MDT, 17:00 UTC) and February's grant of 2 with 1 spent. Opening events grant 3; the family service's sum at the import is 3",
			"evt_in_old1 and evt_in_old2 are seeded as finished: Stripe delivering evt_in_old2 again to the new endpoint is a duplicate and grants nothing",
			"15 March: the cron books January's 2 at 17:00 UTC; the renewal rolls February's 1 over and grants 2: 3. The family service's lots give 3 as well (February's 1 + March's 2). 15 April 12:00 MDT: the rolled 1 lapses: 2 (the family service: 2)",
			"money: only the renewal is in the log: 260.00, fee 7.84",
		],
	},
	{
		id: "credits-import-refund",
		title:
			"import then refund of a pre-import invoice: the seeded index finds the holder, and the full refund takes the invoice's credits back",
		path: "grantsStateFromCallerRows + seedHandlerIndexes, then charge.refunded of an invoice the handler never saw",
		menus: { "1": baseMenu },
		steps: [
			(() => {
				const member = membership({ menuVersion: 1, periodEnd: ms(FEB15) });
				const lots = callerGrant({
					membership: member,
					menu: baseMenu,
					invoice: {
						id: "in_old1",
						reason: "subscription_create",
						periodStart: ms(JAN15),
						periodEnd: ms(FEB15),
						atMs: ms(JAN15),
					},
					existing: [],
				});
				return {
					kind: "import" as const,
					at: ms("2026-02-01T12:00:00Z"),
					membership: member,
					lots,
					eventIds: ["evt_in_old1"],
					invoices: [refs("in_old1")],
				};
			})(),
			{
				at: ms("2026-02-05T12:00:00Z"),
				event: refundOf({
					id: "evt_re_1",
					invoiceId: "in_old1",
					amount: SPARKLE_2,
					charged: SPARKLE_2,
					at: ms("2026-02-05T12:00:00Z"),
				}),
				answer: [200, "applied"],
			},
			{ kind: "ship", at: ms("2026-02-05T13:00:00Z") },
		],
		verdict: "DISCREPANCY",
		discrepancies: ["D8"],
		books: [
			{
				school: SCHOOL,
				// the refund hands 260.00 back: Stripe's balance falls by it, and the member's 2 visits go
				hand: {
					refunds: SPARKLE_2,
					stripe: -SPARKLE_2,
					net: -SPARKLE_2,
					[visits(FAMILY)]: 0,
				},
				// D8: the handler never booked the invoice's payment (the family service did, before the import), so it books no
				// refund of it either; the credits are taken back all the same
				pinned: { refunds: 0, stripe: 0, net: 0 },
				stripe: {
					invoices: [stripeInvoice("in_old1", SPARKLE_2, JAN15)],
					refunds: [
						stripeRefund("re_1", SPARKLE_2, "2026-02-05T12:00:00Z", "in_old1"),
					],
					disputes: [],
					payouts: [],
					balanceTransactions: [
						stripeBalance(
							"txn_re_1",
							"refund",
							-SPARKLE_2,
							0,
							"2026-02-05T12:00:00Z",
						),
					],
				},
				reconcile: {
					"2026-02": ["missing_in_log refund re_1", "amount_differs net -"],
				},
			},
		],
		notes: [
			"the family service imports a sparkle-2 member on 1 February with its January lot (2 visits, invoice in_old1 paid on 15 January, before the import). seedHandlerIndexes indexes the invoice and its payment refs",
			"5 February: Stripe refunds the whole 260.00 (charge.refunded). The index finds the holder, the full refund takes the invoice's 2 visits back (credit.adjusted -2): 0 left. Without the seed the refund would wait for ever (409 unmatched_payment)",
			"DISCREPANCY D8: the handler never booked the invoice's payment, so it books no payment.refunded. The hand numbers are what a refund should do (refunds 260.00, cash and net -260.00); pinned is today's 0. Reconcile prints missing_in_log refund re_1 and amount_differs net",
		],
	},
];
