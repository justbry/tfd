// SPDX-License-Identifier: Apache-2.0
/**
 * The portfolio of an organization party (promissory-notes plan, step 4): one row per note read from the chosen role's
 * view, totals grouped by currency, and a board report that carries only fields safe to share. Pure: the notes and the
 * date are the only inputs. No amount ever crosses a currency, and the report never carries free text, dispute reasons,
 * notice contents, agent refs or event ids.
 */

import { compareDates } from "./date";
import { formatMinor, parseMinor } from "./money";
import { statement } from "./statement";
import type {
	CivilDate,
	MinorString,
	Role,
	Statement,
	TermsState,
} from "./types";

/** Days overdue, in four steps. A closed note or a payoff of 0 is always `current`. */
export type AgingBucket = "current" | "1-30" | "31-60" | "61+";

export const AGING_BUCKETS: readonly AgingBucket[] = [
	"current",
	"1-30",
	"31-60",
	"61+",
];

const LAST_DAY_OF_FIRST_BUCKET = 30;
const LAST_DAY_OF_SECOND_BUCKET = 60;

export interface PortfolioNote {
	note_id: string;
	/** Whose view the organization reads. */
	role: Role;
	/** The note's event stream, validated here. */
	events: unknown[];
}

export interface PortfolioRow {
	note_id: string;
	currency: string;
	exponent: number;
	role: Role;
	/** The chosen view's payoff on the date. */
	payoff_minor: MinorString;
	/** The chosen view's overdue amount; `"0"` on a closed note. */
	overdue_minor: MinorString;
	/** Days from the earliest unmet due date; 0 on a closed note. */
	days_overdue: number;
	aging: AgingBucket;
	/** Difference items still claimed by one party and unanswered by the other. */
	awaiting_confirmation: number;
	/** Difference items in dispute. */
	disputed: number;
	terms: TermsState;
	closed: boolean;
	/** The earliest later installment date that the view's payments do not yet cover, else null. */
	next_due: CivilDate | null;
}

export interface InvalidNote {
	note_id: string;
	error: string;
}

export type BucketCounts = Record<AgingBucket, number>;

/** Totals for one currency (and exponent, so two scales of one code never mix). */
export interface CurrencyTotals {
	currency: string;
	exponent: number;
	notes: number;
	/** Payoff of notes that are not closed. */
	outstanding_payoff_minor: MinorString;
	overdue_minor: MinorString;
	buckets: BucketCounts;
	awaiting_confirmation: number;
	disputed: number;
	/** Notes whose terms the borrower has not yet accepted or declined. */
	terms_pending: number;
}

export interface Portfolio {
	as_of: CivilDate;
	/** Sorted by days overdue, most overdue first, then by note id. */
	rows: PortfolioRow[];
	/** Sorted by currency, then exponent. */
	totals: CurrencyTotals[];
	invalid: InvalidNote[];
}

export const agingBucket = (daysOverdue: number): AgingBucket => {
	if (daysOverdue <= 0) {
		return "current";
	}
	if (daysOverdue <= LAST_DAY_OF_FIRST_BUCKET) {
		return "1-30";
	}
	return daysOverdue <= LAST_DAY_OF_SECOND_BUCKET ? "31-60" : "61+";
};

const nextDue = (
	computed: Statement,
	paid: bigint,
	asOf: CivilDate,
): CivilDate | null => {
	let cumulative = 0n;
	for (const row of computed.schedule) {
		cumulative += parseMinor(row.payment_minor);
		if (compareDates(row.due, asOf) > 0 && cumulative > paid) {
			return row.due;
		}
	}
	return null;
};

const countStatuses = (
	computed: Statement,
): { awaiting: number; disputed: number } => {
	let awaiting = 0;
	let disputed = 0;
	for (const item of computed.difference) {
		if (
			item.status === "claimed-by-lender" ||
			item.status === "claimed-by-borrower"
		) {
			awaiting += 1;
		} else if (item.status === "disputed") {
			disputed += 1;
		}
	}
	return { awaiting, disputed };
};

const rowFor = (note: PortfolioNote, asOf: CivilDate): PortfolioRow => {
	const computed = statement(note.events, asOf);
	const isLender = note.role === "lender";
	const balance = isLender ? computed.lender : computed.borrower;
	const { expected } = computed;
	const { closed, terms } = computed.state;
	const payoff = parseMinor(balance.payoff_minor);
	const settled = closed || payoff === 0n;
	const overdue = isLender
		? expected.lender_overdue_minor
		: expected.borrower_overdue_minor;
	const rawDays = isLender
		? expected.lender_days_overdue
		: expected.borrower_days_overdue;
	const paid = parseMinor(
		isLender ? expected.lender_paid_minor : expected.borrower_paid_minor,
	);
	const daysOverdue = settled ? 0 : rawDays;
	const { awaiting, disputed } = countStatuses(computed);
	return {
		note_id: note.note_id,
		currency: computed.currency,
		exponent: computed.exponent,
		role: note.role,
		payoff_minor: balance.payoff_minor,
		overdue_minor: settled ? "0" : overdue,
		days_overdue: daysOverdue,
		aging: agingBucket(daysOverdue),
		awaiting_confirmation: awaiting,
		disputed,
		terms,
		closed,
		next_due: settled ? null : nextDue(computed, paid, asOf),
	};
};

const compareText = (left: string, right: string): number => {
	if (left < right) {
		return -1;
	}
	return left > right ? 1 : 0;
};

const compareRows = (left: PortfolioRow, right: PortfolioRow): number =>
	right.days_overdue - left.days_overdue ||
	compareText(left.note_id, right.note_id);

interface TotalsAccumulator {
	currency: string;
	exponent: number;
	notes: number;
	payoff: bigint;
	overdue: bigint;
	buckets: BucketCounts;
	awaiting: number;
	disputed: number;
	termsPending: number;
}

const totalsFor = (rows: PortfolioRow[]): CurrencyTotals[] => {
	const groups = new Map<string, TotalsAccumulator>();
	for (const row of rows) {
		const key = `${row.currency}/${row.exponent}`;
		let group = groups.get(key);
		if (group === undefined) {
			group = {
				currency: row.currency,
				exponent: row.exponent,
				notes: 0,
				payoff: 0n,
				overdue: 0n,
				buckets: { current: 0, "1-30": 0, "31-60": 0, "61+": 0 },
				awaiting: 0,
				disputed: 0,
				termsPending: 0,
			};
			groups.set(key, group);
		}
		group.notes += 1;
		if (!row.closed) {
			group.payoff += parseMinor(row.payoff_minor);
		}
		group.overdue += parseMinor(row.overdue_minor);
		group.buckets[row.aging] += 1;
		group.awaiting += row.awaiting_confirmation;
		group.disputed += row.disputed;
		if (row.terms === "proposed") {
			group.termsPending += 1;
		}
	}
	return [...groups.values()]
		.sort(
			(left, right) =>
				compareText(left.currency, right.currency) ||
				left.exponent - right.exponent,
		)
		.map((group) => ({
			currency: group.currency,
			exponent: group.exponent,
			notes: group.notes,
			outstanding_payoff_minor: formatMinor(group.payoff),
			overdue_minor: formatMinor(group.overdue),
			buckets: group.buckets,
			awaiting_confirmation: group.awaiting,
			disputed: group.disputed,
			terms_pending: group.termsPending,
		}));
};

/**
 * Every note read through the organization's role on `asOf`. A note whose events fail validation (or whose date is
 * before its issue date) goes to `invalid` and the rest still compute. Totals never add across currencies.
 */
export const portfolio = (
	notes: readonly PortfolioNote[],
	asOf: CivilDate,
): Portfolio => {
	const rows: PortfolioRow[] = [];
	const invalid: InvalidNote[] = [];
	for (const note of notes) {
		try {
			rows.push(rowFor(note, asOf));
		} catch (error) {
			invalid.push({
				note_id: note.note_id,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	rows.sort(compareRows);
	return { as_of: asOf, rows, totals: totalsFor(rows), invalid };
};

/** One row of the board report: counts, amounts and dates only. No id of an event, no agent, no free text. */
export interface BoardRow {
	note_id: string;
	currency: string;
	exponent: number;
	role: Role;
	payoff_minor: MinorString;
	overdue_minor: MinorString;
	days_overdue: number;
	aging: AgingBucket;
	awaiting_confirmation: number;
	disputed: number;
	terms: TermsState;
	closed: boolean;
	next_due: CivilDate | null;
}

export interface BoardReport {
	generated_for: CivilDate;
	totals: CurrencyTotals[];
	rows: BoardRow[];
	/** How many notes could not be computed; the report does not say why. */
	not_computed: number;
}

/** The portfolio reduced to the fields that are safe to put in front of a board. Builds new objects; copies nothing else. */
export const boardReport = (
	source: Portfolio,
	asOf: CivilDate,
): BoardReport => ({
	generated_for: asOf,
	totals: source.totals.map((total) => ({
		currency: total.currency,
		exponent: total.exponent,
		notes: total.notes,
		outstanding_payoff_minor: total.outstanding_payoff_minor,
		overdue_minor: total.overdue_minor,
		buckets: {
			current: total.buckets.current,
			"1-30": total.buckets["1-30"],
			"31-60": total.buckets["31-60"],
			"61+": total.buckets["61+"],
		},
		awaiting_confirmation: total.awaiting_confirmation,
		disputed: total.disputed,
		terms_pending: total.terms_pending,
	})),
	rows: source.rows.map((row) => ({
		note_id: row.note_id,
		currency: row.currency,
		exponent: row.exponent,
		role: row.role,
		payoff_minor: row.payoff_minor,
		overdue_minor: row.overdue_minor,
		days_overdue: row.days_overdue,
		aging: row.aging,
		awaiting_confirmation: row.awaiting_confirmation,
		disputed: row.disputed,
		terms: row.terms,
		closed: row.closed,
		next_due: row.next_due,
	})),
	not_computed: source.invalid.length,
});

export const BOARD_CSV_HEADER: readonly string[] = [
	"note_id",
	"currency",
	"exponent",
	"role",
	"payoff_minor",
	"overdue_minor",
	"days_overdue",
	"aging",
	"awaiting_confirmation",
	"disputed",
	"terms",
	"closed",
	"next_due",
];

const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];
const QUOTE_TRIGGERS = /[",\r\n]/;
const INTEGER_PATTERN = /^-?\d+$/;

/** A text cell: a leading formula character gets a single quote in front, then RFC 4180 quoting where needed. */
const textCell = (value: string): string => {
	const hardened = FORMULA_PREFIXES.some((prefix) => value.startsWith(prefix))
		? `'${value}`
		: value;
	return QUOTE_TRIGGERS.test(hardened)
		? `"${hardened.replaceAll('"', '""')}"`
		: hardened;
};

/** A numeric cell, written as plain digits. A value that is not an integer is refused, never written as text. */
const integerCell = (value: string | number): string => {
	const text = String(value);
	if (!INTEGER_PATTERN.test(text)) {
		throw new Error(
			`CSV numeric cell is not an integer: ${JSON.stringify(text)}`,
		);
	}
	return text;
};

const boardCsvLine = (row: BoardRow): string =>
	[
		textCell(row.note_id),
		textCell(row.currency),
		integerCell(row.exponent),
		textCell(row.role),
		integerCell(row.payoff_minor),
		integerCell(row.overdue_minor),
		integerCell(row.days_overdue),
		textCell(row.aging),
		integerCell(row.awaiting_confirmation),
		integerCell(row.disputed),
		textCell(row.terms),
		row.closed ? "true" : "false",
		row.next_due === null ? "" : textCell(row.next_due),
	].join(",");

/**
 * The board report's rows as CSV: a fixed header, RFC 4180 quoting, `\n` line ends and a final `\n`. Amounts are plain
 * integer minor units beside a currency column. A text cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage
 * return is prefixed with `'` so a spreadsheet reads it as text; numeric columns are checked to be integers instead.
 */
export const boardReportCsv = (report: BoardReport): string => {
	const lines = [BOARD_CSV_HEADER.join(","), ...report.rows.map(boardCsvLine)];
	return `${lines.join("\n")}\n`;
};
