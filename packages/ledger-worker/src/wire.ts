/**
 * The wire shapes of contract section 11 that are the Worker's own. They follow `packages/ledger-ui/src/data/` (the
 * orchestrator's, which this package may not import or edit) with the `null`s section 11 asks that contract to allow.
 */
import type { Cell } from "tfd/worker";

export type CreditUnit = { one: string; other: string };

export type StatementAmounts = {
	memberships: number;
	bookings: number;
	/** No event records a discount. */
	discounts: number | null;
	/** Income less fundraising. */
	income: number;
	refunds: number;
	fees: number;
	/** What `hledger is` prints: it includes disputes and the B4 Uni share. */
	net: number;
	giftsSold: number | null;
	paidOut: number;
};

export type IncomeSeries = {
	step: "day" | "week";
	points: Array<{ start: string; amountCents: number }>;
	through: string;
	totalCents: number;
	peak: { start: string; amountCents: number } | null;
};

export type IncomeStatementWire = {
	school: string;
	from: string;
	to: string;
	currency: string | null;
	unit: CreditUnit | null;
	basis: { kind: "cash" };
	matchesStripe: null;
	counts: { payments: number; refunds: number; payouts: number };
	amounts: StatementAmounts;
	giftsOutstanding: null;
	income: IncomeSeries;
	previous: {
		from: string;
		to: string;
		amounts: StatementAmounts;
		changes: StatementAmounts;
		income: IncomeSeries;
	} | null;
};

export type ReportCell =
	| Cell
	| { hidden: "embargoed"; until: string }
	| { hidden: "members_only" | "no_grant"; who: string };

export type AudienceReportWire = {
	audience: "public" | "member" | "governance";
	grain: "year" | "quarter" | "month";
	periodLabel: string;
	payments: ReportCell;
	periods: Array<{ label: string; income: ReportCell }>;
	figures: {
		memberships: ReportCell;
		bookings: ReportCell;
		discounts: ReportCell;
		income: ReportCell;
		refunds: ReportCell;
		fees: ReportCell;
		net: ReportCell;
		paidOut: ReportCell;
		giftsOutstanding: ReportCell;
	};
	tiers: Array<{ name: string; income: ReportCell }>;
	rounding: { unitCents: number; size: "small" | "large" } | null;
};

export type PaymentRowWire = {
	date: string;
	description: string;
	amountCents: number;
	status: "Paid" | "Open" | "Refunded" | "Partly refunded" | "Failed";
	invoiceId: string | null;
	paymentId: string | null;
};

export type HistoryEventWire = {
	at: string;
	type: string;
	kind: string | null;
	text: string;
	credits: number | null;
	amountCents: number | null;
	bookingId: string | null;
	/** The code as the Promos tab masks it: the log holds the promo's id only. */
	promo: string | null;
	source: string;
};
