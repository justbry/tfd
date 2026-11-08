/**
 * Shared pieces of the D12 golden bundles (`tests/gap/credits-rules.ts`, `credits-import.ts`): a tier invoice for a family,
 * Stripe's side of it, and the numbers every bundle writes by hand (Stripe's fee is 2.9% + 30 cents, rounded).
 */
import { HOUR, invoice, ms, tierLine } from "./e2e-events.js";
import {
	type Answer,
	type Step,
	stripeBalance,
	stripeInvoice,
} from "./e2e-matrix.js";
import { FAMILY } from "./handler-harness.js";
import type { RawEvent } from "./stripe-events.js";

export { HOUR, ms };

export const SPARKLE_1 = 13_000;
export const SPARKLE_2 = 26_000;
export const SPARKLE_4 = 52_000;
/** 26,000 x 2.9% = 754 + 30. */
export const FEE_SPARKLE_2 = 784;
/** 13,000 x 2.9% = 377 + 30. */
export const FEE_SPARKLE_1 = 407;
/** 52,000 x 2.9% = 1,508 + 30. */
export const FEE_SPARKLE_4 = 1_538;

export const visits = (family: string): string =>
	`avail:family:${family}:visit`;
export const stamp = (atMs: number): string =>
	`${new Date(atMs).toISOString().slice(0, 19)}Z`;

export const applied = (at: number, event: RawEvent): Step => ({
	at,
	event,
	answer: [200, "applied"] satisfies Answer,
});

export type Cycle = { start: number; end: number };

/** A tier invoice of a family's subscription: the cycle it pays for, and for a renewal the cycle after (the line's period). */
export const tierInvoice = (o: {
	id: string;
	at: number;
	reason: "subscription_create" | "subscription_cycle" | "subscription_update";
	cycle: Cycle;
	next?: Cycle;
	tier: string;
	amount: number;
	family?: string;
	subscription?: string;
	quantity?: number;
}): RawEvent =>
	invoice({
		id: o.id,
		at: o.at,
		reason: o.reason,
		start: o.cycle.start,
		end: o.cycle.end,
		subscription: o.subscription ?? "sub_1",
		family: o.family ?? FAMILY,
		lines: [
			tierLine(o.tier, {
				amount: o.amount,
				...(o.quantity === undefined ? {} : { quantity: o.quantity }),
				...(o.next ? { periodStart: o.next.start, periodEnd: o.next.end } : {}),
			}),
		],
	});

/** What Stripe lists for a paid tier invoice: the invoice and its charge's balance transaction. */
export const stripeOfPayments = (
	payments: { id: string; amount: number; fee: number; at: number }[],
) => ({
	invoices: payments.map((p) => stripeInvoice(p.id, p.amount, stamp(p.at))),
	refunds: [],
	disputes: [],
	payouts: [],
	balanceTransactions: payments.map((p) =>
		stripeBalance(`txn_${p.id}`, "charge", p.amount, p.fee, stamp(p.at)),
	),
});
