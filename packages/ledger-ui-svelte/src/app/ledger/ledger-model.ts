import {
	drillLabels,
	type LedgerDrill,
	type LedgerEntry,
	type LedgerTypeFilter,
} from "$contract/data/ledger.ts";
import type { BooksIconName } from "../books-shared/books-icons.ts";

/** The Ledger tab's data that is not markup (the Preact package's ledger.tsx): the type chips, an event's colour and
 * icon, the Amount column, the route's drill-down. */

/** The mockup's bkBlocked admin branch: an admin without the finance grant still has Members. */
export const adminBooksSentence =
	"Admins without the finance grant see the roster, balances and bookings in Members.";

export const columnCount = 6;

export type TypeChip = {
	slug: string;
	type: LedgerTypeFilter | null;
	/** Null: the credit chip, named after the school's credit unit. */
	label: string | null;
	icon: BooksIconName | null;
};

export const typeChips: TypeChip[] = [
	{ slug: "all", type: null, label: "All", icon: null },
	{ slug: "payment", type: "payment", label: "Payments", icon: "coin" },
	{ slug: "credit", type: "credit", label: null, icon: "ticket" },
	{ slug: "booking", type: "booking", label: "Bookings", icon: "clock" },
	{ slug: "code", type: "code", label: "Promos", icon: "tag" },
	{ slug: "payout", type: "payout", label: "Payouts", icon: "bank" },
	{ slug: "admin", type: "admin", label: "Admin actions", icon: "user" },
];

/** The type the route asks for, if it is one of the chips'; an unknown one is ignored. */
export const typeOf = (asked: string | null): LedgerTypeFilter | null =>
	typeChips.find((chip) => chip.type !== null && chip.type === asked)?.type ??
	null;

export const isDrill = (value: string | null): value is LedgerDrill =>
	value !== null && value in drillLabels;

/** The mockup's `C`: the colour of an event's badge border. */
export const eventColors: Record<string, string> = {
	"credit.granted": "var(--success)",
	"credit.spent": "var(--chart-1)",
	"credit.held": "var(--chart-3,var(--warning))",
	"credit.released": "var(--muted-foreground)",
	"credit.forfeited": "var(--destructive)",
	"credit.depleted": "var(--destructive)",
	"credit.refunded": "var(--warning)",
	"credit.adjusted": "var(--chart-5,var(--primary))",
	"payment.succeeded": "var(--info)",
	"payment.refunded": "var(--warning)",
};

const eventIcons: Record<string, BooksIconName> = {
	"payment.refunded": "undo",
	"payout.paid": "bank",
	"credit.granted": "plus",
	"credit.spent": "check",
	"credit.held": "clock",
	"credit.released": "unlock",
	"credit.forfeited": "ban",
	"credit.depleted": "alert",
	"credit.refunded": "undo",
	"credit.expired": "clock",
	"credit.adjusted": "sliders",
	"catalog.published": "layers",
};

/** The mockup's `evIcon`: the icon of an event's badge. */
export function eventIconOf({ event }: LedgerEntry): BooksIconName {
	if (event.event_type !== "payment.succeeded")
		return eventIcons[event.event_type] ?? "dot";
	if (event.labels.kind === "booking") return "ticket";
	return event.labels.kind === "gift" ? "gift" : "coin";
}

/** The Amount column: two decimals, signed, no currency; a payout is shown without a sign (mockup `usd`). */
export function entryAmount({ event, amountCents }: LedgerEntry): string {
	if (amountCents === null) return "";
	const text = (Math.abs(amountCents) / 100).toFixed(2);
	if (event.event_type === "payout.paid") return text;
	return `${amountCents < 0 ? "−" : "+"}${text}`;
}

/** The details line of a row opened by its Details button. */
export const detailsJson = ({ event }: LedgerEntry): string =>
	JSON.stringify({
		id: event.id,
		event_type: event.event_type,
		key: event.key,
		labels: event.labels,
		postings: event.postings,
	});
