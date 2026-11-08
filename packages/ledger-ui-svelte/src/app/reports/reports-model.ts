import { monthAndDay } from "$contract/app/period.ts";
import { type Route, withQuery } from "$contract/app/route.ts";
import type {
	AudienceReport,
	CsvColumn,
	IncomeSeries,
	LedgerDrill,
	ReportCell,
	StatementAmounts,
} from "$contract/data/ledger.ts";
import type { BooksIconName } from "../books-shared/books-icons.ts";
import { cellText, formatMoney } from "../books-shared/books-text.ts";

/** The Reports tab's data that is not markup (the Preact package's reports.tsx): the KPI tiles, the statement's lines,
 * the sparkline's geometry, the audience document's CSV. */

export const drillTitle = "Show these events in the ledger";
export const financeOnlyTitle = "Finance admins only: the rows behind a figure";
export const grainWords = {
	year: "years",
	quarter: "quarters",
	month: "months",
};
/** A figure the source does not record yet (the Worker answers null): never shown as 0. */
export const notAvailableText = "—";
export const whoSees: Record<AudienceReport["audience"], string> = {
	public: "Public sees",
	member: "Members see",
	governance: "Governance sees",
};

export const statementAmount = (
	cents: number | null,
	currency: string | null,
): string => (cents === null ? notAvailableText : formatMoney(cents, currency));

export const slug = (text: string): string =>
	text.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** "▲ $X vs <period>": the server's change of the line, signed; the UI formats it and never subtracts. */
export const changeText = (
	change: number,
	currency: string | null,
	label: string,
): string =>
	`${change >= 0 ? "▲" : "▼"} ${formatMoney(Math.abs(change), currency)} vs ${label}`;

export const kpis: Array<{
	item: string;
	label: string;
	icon: BooksIconName;
	drill: LedgerDrill;
	field: "income" | "refunds" | "fees" | "paidOut";
}> = [
	{
		item: "income",
		label: "Income",
		icon: "coin",
		drill: "income",
		field: "income",
	},
	{
		item: "refund",
		label: "Refunds",
		icon: "undo",
		drill: "refund",
		field: "refunds",
	},
	{
		item: "fees",
		label: "Stripe fees",
		icon: "receipt",
		drill: "fees",
		field: "fees",
	},
	{
		item: "payout",
		label: "Paid out",
		icon: "bank",
		drill: "payout",
		field: "paidOut",
	},
];

/** The statement's rows (mockup `stmt`): its label, its amount, the drill-down it opens (none for Net) and how it is
 * drawn. */
export const statementRows: Array<{
	line: string;
	label: string;
	field: keyof StatementAmounts;
	drill: LedgerDrill | null;
	indented: boolean;
	bold: boolean;
	negative: boolean;
}> = [
	{
		line: "memberships",
		label: "Memberships",
		field: "memberships",
		drill: "memb",
		indented: true,
		bold: false,
		negative: false,
	},
	{
		line: "bookings",
		label: "Bookings and events",
		field: "bookings",
		drill: "book",
		indented: true,
		bold: false,
		negative: false,
	},
	{
		line: "discounts",
		label: "Discounts given",
		field: "discounts",
		drill: "disc",
		indented: true,
		bold: false,
		negative: true,
	},
	{
		line: "income",
		label: "Income",
		field: "income",
		drill: "income",
		indented: false,
		bold: true,
		negative: false,
	},
	{
		line: "refunds",
		label: "Refunds",
		field: "refunds",
		drill: "refund",
		indented: false,
		bold: false,
		negative: true,
	},
	{
		line: "fees",
		label: "Stripe fees",
		field: "fees",
		drill: "fees",
		indented: false,
		bold: false,
		negative: true,
	},
	{
		line: "net",
		label: "Net",
		field: "net",
		drill: null,
		indented: false,
		bold: true,
		negative: false,
	},
];

/** The Ledger with a drill-down (mockup `drill`): the period stays, the type goes back to All. */
export const ledgerRoute = (route: Route, drill: LedgerDrill): Route => ({
	...withQuery(
		withQuery(withQuery(route, "drill", drill), "type", null),
		"promo",
		null,
	),
	tab: "ledger",
});

// ---- The sparkline (mockup `spark`).

export const sparkWidth = 600;
export const sparkHeight = 56;

export const sparkLabel = (series: IncomeSeries, start: string): string =>
	series.step === "day" ? monthAndDay(start) : `week of ${monthAndDay(start)}`;

export type SparkShape = {
	title: string;
	area: string;
	income: string;
	previous: string | null;
	slot: number;
	columns: Array<{
		start: string;
		x: number;
		label: string;
		amountCents: number;
	}>;
};

/** The series as the sparkline draws it: the polygon, the two lines and one column per point to hover, all scaled to
 * the highest of the two periods. Only drawing: the amounts are the Reader's. */
export function sparkShape(
	series: IncomeSeries,
	previous: IncomeSeries | null,
): SparkShape {
	const amounts = series.points.map(({ amountCents }) => amountCents);
	const before = previous
		? previous.points
				.slice(0, amounts.length)
				.map(({ amountCents }) => amountCents)
		: null;
	const highest = Math.max(1, ...amounts, ...(before ?? [0]));
	const x = (index: number): number =>
		amounts.length > 1
			? (index * sparkWidth) / (amounts.length - 1)
			: sparkWidth / 2;
	const y = (value: number): number =>
		sparkHeight - 4 - (value / highest) * (sparkHeight - 10);
	const line = (values: number[]): string =>
		values
			.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`)
			.join(" ");
	const slot = sparkWidth / amounts.length;
	return {
		title: `${series.step === "day" ? "Daily" : "Weekly"} income`,
		area: `0,${sparkHeight} ${line(amounts)} ${sparkWidth},${sparkHeight}`,
		income: line(amounts),
		previous: before ? line(before) : null,
		slot,
		columns: series.points.map((point, index) => ({
			start: point.start,
			x: x(index) - slot / 2,
			label: sparkLabel(series, point.start),
			amountCents: point.amountCents,
		})),
	};
}

// ---- The audience document's CSV.

export type DocumentRow = {
	line: string;
	kpi: string;
	value: string;
	hidden: string;
};

export const documentColumns = (
	document: AudienceReport,
): Array<CsvColumn<DocumentRow>> => [
	{ header: "line", kind: "text", value: (row) => row.line },
	{ header: "kpi", kind: "text", value: (row) => row.kpi },
	{ header: "value", kind: "text", value: (row) => row.value },
	{ header: "hidden", kind: "text", value: (row) => row.hidden },
	{ header: "audience", kind: "text", value: () => document.audience },
	{ header: "period", kind: "text", value: () => document.periodLabel },
];

/** The document's six figures as `reportDocCsv` lists them. */
export function documentRows(
	document: AudienceReport,
	currency: string | null,
): DocumentRow[] {
	const { figures } = document;
	const whole = document.rounding !== null;
	const lines: Array<{
		line: string;
		kpi: string;
		cell: ReportCell;
		money: boolean;
	}> = [
		{
			line: "Income",
			kpi: "gross_collected",
			cell: figures.income,
			money: true,
		},
		{ line: "Refunds", kpi: "refunds", cell: figures.refunds, money: true },
		{
			line: "Stripe fees",
			kpi: "stripe_fees",
			cell: figures.fees,
			money: true,
		},
		{ line: "Net", kpi: "net_income", cell: figures.net, money: true },
		{ line: "Paid out", kpi: "payouts", cell: figures.paidOut, money: true },
		{
			line: "Payments",
			kpi: "payments_count",
			cell: document.payments,
			money: false,
		},
	];
	return lines.map(({ line, kpi, cell, money }) => ({
		line,
		kpi,
		...cellText(cell, money, currency, whole),
	}));
}

/** The lines of an audience document's statement table. */
export type DocumentLine = {
	line: string;
	label: string;
	cell: ReportCell;
	indented: boolean;
	bold: boolean;
};

export function documentLines(document: AudienceReport): DocumentLine[] {
	const { figures } = document;
	return [
		{
			line: "memberships",
			label: "Memberships",
			cell: figures.memberships,
			indented: true,
			bold: false,
		},
		...document.tiers.map(({ name, income }) => ({
			line: "tier",
			label: `· ${name}`,
			cell: income,
			indented: true,
			bold: false,
		})),
		{
			line: "bookings",
			label: "Bookings and events",
			cell: figures.bookings,
			indented: true,
			bold: false,
		},
		{
			line: "discounts",
			label: "Discounts given",
			cell: figures.discounts,
			indented: true,
			bold: false,
		},
		{
			line: "income",
			label: "Income",
			cell: figures.income,
			indented: false,
			bold: true,
		},
		{
			line: "refunds",
			label: "Refunds",
			cell: figures.refunds,
			indented: false,
			bold: false,
		},
		{
			line: "fees",
			label: "Stripe fees",
			cell: figures.fees,
			indented: false,
			bold: false,
		},
		{
			line: "net",
			label: "Net",
			cell: figures.net,
			indented: false,
			bold: true,
		},
	];
}
