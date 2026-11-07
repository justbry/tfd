/**
 * `GET /v1/schools/:school/members/:key/money`: the money half of the UI's `memberDetail`, from the member's finance
 * object (payments and refunds) and the member's events (history). No name, email or Stripe customer id is in either.
 */

import type { AtmEvent } from "atm";
import { type FinanceMemberObject, ledgerRows } from "atm/worker";
import type { SchoolSnapshot } from "../data/snapshot.js";
import { viewValue } from "../data/snapshot.js";
import { ApiError } from "../http.js";
import type { HistoryEventWire, PaymentRowWire } from "../wire.js";

const PAGE_SIZE = 1000;
const WHOLE_LOG = { from: "0000-01-01", to: "9999-12-31" };
const INVOICE = /^in_/;
const MEMBERSHIP_PREFIX = "membership:";

const descriptionOf = (incomeKind: string | null): string => {
	if (incomeKind === null) return "Payment";
	if (incomeKind.startsWith(MEMBERSHIP_PREFIX))
		return `Membership ${incomeKind.slice(MEMBERSHIP_PREFIX.length)}`;
	return incomeKind === "booking" ? "Booking payment" : "Payment";
};

/** Newest first, as the drawer shows them: a refund is its own row, negative, and its payment reads as refunded. */
export const paymentRowsOf = (
	member: Pick<FinanceMemberObject, "payments" | "refunds">,
): PaymentRowWire[] => {
	const refundedFor = (payment: FinanceMemberObject["payments"][number]) =>
		member.refunds
			.filter(
				(refund) =>
					(refund.paymentIntent !== null &&
						refund.paymentIntent === payment.paymentIntent) ||
					(refund.invoice !== null && refund.invoice === payment.id),
			)
			.reduce((total, refund) => total + refund.amountCents, 0);
	const rows: Array<PaymentRowWire & { order: string }> = [
		...member.payments.map((payment) => {
			const refunded = refundedFor(payment);
			return {
				order: payment.eventId,
				date: payment.date,
				description: descriptionOf(payment.incomeKind),
				amountCents: payment.amountCents,
				status:
					refunded <= 0
						? ("Paid" as const)
						: refunded >= payment.amountCents
							? ("Refunded" as const)
							: ("Partly refunded" as const),
				invoiceId: INVOICE.test(payment.id) ? payment.id : null,
				paymentId:
					payment.paymentIntent ??
					(INVOICE.test(payment.id) ? null : payment.id),
			};
		}),
		...member.refunds.map((refund) => ({
			order: refund.eventId,
			date: refund.date,
			description: "Refund",
			amountCents: 0 - refund.amountCents,
			status: "Refunded" as const,
			invoiceId: refund.invoice,
			paymentId: refund.paymentIntent ?? refund.id,
		})),
	];
	return rows
		.sort((a, b) => (a.order < b.order ? 1 : a.order > b.order ? -1 : 0))
		.map(({ order: _order, ...row }) => row);
};

export const historyOf = (events: readonly AtmEvent[]): HistoryEventWire[] => {
	const history: HistoryEventWire[] = [];
	let cursor: string | null = null;
	do {
		const page = ledgerRows(events, WHOLE_LOG, cursor, PAGE_SIZE);
		for (const row of page.rows)
			history.push({
				at: row.localTime,
				type: row.event.event_type,
				kind: row.event.labels.kind ?? null,
				text: row.event.text,
				credits: row.credits,
				amountCents: row.amountCents,
				bookingId: row.event.labels.booking ?? null,
				promo: null,
				source: row.event.source,
			});
		cursor = page.next;
	} while (cursor !== null);
	return history;
};

export const memberMoneyRoute = async (
	snapshot: SchoolSnapshot,
	key: string,
): Promise<{ payments: PaymentRowWire[]; history: HistoryEventWire[] }> => {
	const finance = await snapshot.reader.financeMember(key);
	const summary = await snapshot.reader.member(key);
	const known = [finance, summary].filter(
		(read) => read.ok || read.error !== "not-in-manifest",
	);
	if (known.length === 0) throw new ApiError("not_found", "No such member.");
	const own =
		finance.ok || finance.error !== "not-in-manifest"
			? viewValue(finance)
			: null;
	if (!summary.ok && summary.error !== "not-in-manifest") viewValue(summary);
	const events = (await snapshot.events()).filter((event) => event.key === key);
	return {
		payments: own === null ? [] : paymentRowsOf(own),
		history: historyOf(events),
	};
};
