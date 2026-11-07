/**
 * Monthly recurring revenue (MRR), booked from the Stripe facts that say it: what a subscription's recurring prices cost
 * a month. The books are cash basis, so a payment says nothing about the months it covers; this keeps the subscription's
 * recurring items in the holder's state (`GrantsState.mrr`) and makes an `mrr.changed` whenever they move, with postings
 * in the `MRR` commodity (whole cents a month) that any reader of the books adds up on its own: the balance of
 * `mrr:recurring:` at a month's end is MRR, and `mrr:movement:<movement>` splits each month's change into new,
 * expansion, contraction and churned.
 *
 * What moves it, each from what Stripe sends:
 * - a USD invoice of a subscription that bills its recurring lines in full (`subscription_create`, `subscription_cycle`,
 *   any reason but `subscription_update`): each line with a recurring price is an item, its amount less its
 *   `discount_amounts` over the months of the price's interval. A one-time line is no item. A free (100%-discounted)
 *   subscription's items add 0 and are booked all the same;
 * - a `customer.subscription.created` or `.updated` whose items differ from the ones held (a seat change, an upgrade,
 *   a downgrade, from the moment Stripe made it): a changed item is its price's `unit_amount` x quantity, discounted by
 *   the share the last full invoice took off;
 * - the subscription's end (`customer.subscription.deleted`, or a status of `canceled`): MRR falls to 0, churned.
 * A proration invoice (`subscription_update`) moves nothing: its lines are the rest of a period, not a price, and Stripe
 * sends the subscription event of the same change. An invoice line names its price by id only (API 2025-10-29.clover):
 * its interval is the price's, as the menu reading of the line gives it (`resolveLines`).
 *
 * A subscription in another currency is never booked (its invoices leave `money.skipped` markers instead), so its
 * subscription events find nothing held and book nothing. Pure.
 */
import { ledgerEvent } from "../ledger/postings.js";
import type {
	AtmEvent,
	BillingInvoice,
	GrantsState,
	Interval,
	MrrItem,
	MrrMovement,
	MrrRecord,
	SubscriptionFact,
} from "../types.js";
import type { Booker } from "./money.js";

const USD = "usd";
const MONTHS_OF: Record<Interval, number> = { month: 1, year: 12 };

/** `num / den` rounded half up, for `num >= 0` and `den > 0`, in integer arithmetic (as the KPI ratios are). */
const halfUp = (num: bigint, den: bigint): number =>
	Number((2n * num + den) / (2n * den));

const itemOf = ({
	priceId,
	interval,
	intervalCount,
	quantity,
	amount,
	discount,
}: {
	priceId: string;
	interval: Interval;
	intervalCount: number;
	quantity: number;
	amount: number;
	discount: number;
}): MrrItem => {
	const months = MONTHS_OF[interval] * intervalCount;
	const gross = Math.max(0, amount);
	const off = Math.min(gross, Math.max(0, discount));
	return {
		priceId,
		interval,
		months,
		quantity,
		amount: gross,
		discount: off,
		cents: halfUp(BigInt(gross - off), BigInt(months)),
	};
};

const sumCents = (items: readonly MrrItem[]): number =>
	items.reduce((total, item) => total + item.cents, 0);

const sameItem = (a: MrrItem, b: MrrItem): boolean =>
	a.priceId === b.priceId &&
	a.quantity === b.quantity &&
	a.cents === b.cents &&
	a.months === b.months;

const sameItems = (a: readonly MrrItem[], b: readonly MrrItem[]): boolean =>
	a.length === b.length &&
	a.every((item, i) => sameItem(item, b[i] as MrrItem));

/** The labels and booker of the decision that moves MRR. */
type Context = {
	labels: Record<string, string>;
	booker: Booker;
	holder: { customerId: string };
};

/** What a decision adds: the events, and the state with the new record (the same state when nothing moved). */
export type MrrDecision = { events: AtmEvent[]; state: GrantsState };

const unchanged = (state: GrantsState): MrrDecision => ({ events: [], state });

/** The movement from `before` to `after`, or null when nothing is worth an event. */
const movementOf = ({
	before,
	after,
	first,
	ended,
}: {
	before: number;
	after: number;
	first: boolean;
	ended: boolean;
}): MrrMovement | null => {
	if (ended) return "churned";
	if (after > before) return before === 0 ? "new" : "expansion";
	if (after < before) return "contraction";
	return first ? "new" : null;
};

const booked = ({
	state,
	next,
	first,
	at,
	from,
	invoiceId,
	context,
}: {
	state: GrantsState;
	next: MrrRecord;
	first: boolean;
	at: number;
	from: "invoice" | "subscription" | "ended";
	invoiceId?: string;
	context: Context;
}): MrrDecision => {
	const prior = state.mrr;
	// What `mrr:recurring:<holder>` holds now: an ended subscription's churn took it to 0.
	const before = prior && !prior.ended ? prior.cents : 0;
	const after = next.cents;
	const movement = movementOf({ before, after, first, ended: next.ended });
	const nextState = { ...state, mrr: next };
	if (movement === null) return { events: [], state: nextState };
	const delta = after - before;
	const idem =
		from === "invoice"
			? `stripe:${invoiceId}:mrr`
			: from === "ended"
				? `stripe:${next.subscriptionId}:mrr:ended`
				: `stripe:${next.subscriptionId}:mrr:${at}`;
	return {
		state: nextState,
		events: [
			ledgerEvent({
				type: "mrr.changed",
				school: context.booker.school,
				tz: context.booker.tz,
				eventTime: at,
				key: context.holder.customerId,
				idem,
				cause: context.booker.cause,
				labels: {
					...context.labels,
					subscription: next.subscriptionId,
					movement,
					mrr: String(after),
				},
				mrr: { delta, movement },
				text: `mrr ${movement} ${delta} cents a month for ${next.subscriptionId}`,
				payload: {
					subscription: next.subscriptionId,
					from,
					...(invoiceId ? { invoice: invoiceId } : {}),
					before,
					after,
					items: next.items.map((item) => ({
						price: item.priceId,
						interval: item.interval,
						months: item.months,
						quantity: item.quantity,
						amount: item.amount,
						discount: item.discount,
						cents: item.cents,
					})),
					...(next.ended ? { ended: true } : {}),
				},
			}),
		],
	};
};

/**
 * A paid (or free) invoice the handler has just decided (a replayed one is decided once, before this): the subscription's
 * recurring items as its full lines bill them. Nothing for an invoice of no subscription, in another currency, of a
 * proration only, or with no recurring line.
 */
export const invoiceMrr = ({
	invoice,
	state,
	context,
}: {
	invoice: BillingInvoice;
	state: GrantsState;
	context: Context;
}): MrrDecision => {
	const subscriptionId = invoice.subscriptionId;
	if (
		subscriptionId === null ||
		invoice.currency !== USD ||
		invoice.reason === "subscription_update"
	)
		return unchanged(state);
	const lines = invoice.lines.filter(
		(line) => !line.proration && line.interval !== null,
	);
	if (lines.length === 0) return unchanged(state);
	const items = lines.map((line) =>
		itemOf({
			priceId: line.priceId ?? line.lookupKey ?? "unknown",
			interval: line.interval as Interval,
			intervalCount: 1,
			quantity: line.quantity,
			amount: line.amount,
			discount: line.discount ?? 0,
		}),
	);
	const prior = state.mrr;
	const first =
		!prior || prior.subscriptionId !== subscriptionId || prior.ended;
	// An invoice older than what the record holds (a late cycle invoice after a subscription change) changes nothing.
	if (!first && prior && invoice.paidAt < prior.at) return unchanged(state);
	const next: MrrRecord = {
		subscriptionId,
		cents: sumCents(items),
		items,
		discount: {
			amount: items.reduce((total, item) => total + item.discount, 0),
			gross: items.reduce((total, item) => total + item.amount, 0),
		},
		at: invoice.paidAt,
		ended: false,
	};
	if (!first && prior && sameItems(prior.items, items))
		return unchanged({ ...state, mrr: { ...prior, at: next.at } });
	return booked({
		state,
		next,
		first,
		at: invoice.paidAt,
		from: "invoice",
		invoiceId: invoice.id,
		context,
	});
};

/**
 * A `customer.subscription.*` event of the subscription the books hold: its end, or its items when they changed. An item
 * held at the same price and quantity keeps what it was booked at; a new or changed one is its unit amount x quantity,
 * discounted as the last full invoice was. An item with no unit amount (or no month or year interval) adds nothing.
 */
export const subscriptionMrr = ({
	subscription,
	state,
	context,
}: {
	subscription: SubscriptionFact;
	state: GrantsState;
	context: Context;
}): MrrDecision => {
	const prior = state.mrr;
	if (
		!prior ||
		prior.subscriptionId !== subscription.id ||
		prior.ended ||
		subscription.at < prior.at ||
		// older than the membership on record: the subscription rules ignored it, and so does MRR
		subscription.at < (state.membership?.at ?? 0)
	)
		return unchanged(state);
	if (subscription.status === "canceled")
		return booked({
			state,
			next: {
				...prior,
				cents: 0,
				items: [],
				at: subscription.at,
				ended: true,
			},
			first: false,
			at: subscription.at,
			from: "ended",
			context,
		});
	const { amount: discounted, gross } = prior.discount;
	const items: MrrItem[] = [];
	for (const item of subscription.items) {
		if (item.interval === null) continue;
		const months = MONTHS_OF[item.interval] * (item.intervalCount ?? 1);
		const held = prior.items.find(
			(old) =>
				old.priceId === item.priceId &&
				old.quantity === item.quantity &&
				old.months === months,
		);
		if (held) {
			items.push(held);
			continue;
		}
		if (item.unitAmount === undefined) continue;
		const amount = item.unitAmount * item.quantity;
		items.push(
			itemOf({
				priceId: item.priceId,
				interval: item.interval,
				intervalCount: item.intervalCount ?? 1,
				quantity: item.quantity,
				amount,
				discount:
					gross > 0
						? halfUp(BigInt(amount) * BigInt(discounted), BigInt(gross))
						: 0,
			}),
		);
	}
	if (sameItems(prior.items, items)) return unchanged(state);
	return booked({
		state,
		next: {
			...prior,
			cents: sumCents(items),
			items,
			at: subscription.at,
		},
		first: false,
		at: subscription.at,
		from: "subscription",
		context,
	});
};
