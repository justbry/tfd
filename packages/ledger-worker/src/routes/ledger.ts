/** `GET /v1/schools/:school/ledger`: `ledgerRows` over the school's events up to `asOf`, as the UI's `LedgerPage`. */
import {
	type LedgerDrill,
	type LedgerRow,
	type LedgerTypeFilter,
	ledgerRows,
} from "atm/worker";
import type { SchoolSnapshot } from "../data/snapshot.js";
import { ApiError } from "../http.js";
import { daysInRange } from "../time.js";
import type { CreditUnit } from "../wire.js";
import { dayRange, oneOf } from "./query.js";

const TYPE_FILTERS = [
	"payment",
	"credit",
	"booking",
	"code",
	"payout",
	"admin",
] as const satisfies readonly LedgerTypeFilter[];
const DRILLS = [
	"income",
	"memb",
	"book",
	"disc",
	"refund",
	"fees",
	"payout",
	"gift",
] as const satisfies readonly LedgerDrill[];
/** A page is one range of at most this many days. */
export const LONGEST_LEDGER_RANGE_DAYS = 62;
const PAGE_SIZE = 1000;

export type LedgerEntryWire = {
	event: LedgerRow["event"];
	pending: false;
	localTime: string;
	member: { key: string } | null;
	credits: number | null;
	amountCents: number | null;
	paymentId: string | null;
	/** The log holds the promo's id, not its code. */
	promo: { id: string; code: null } | null;
};

export type LedgerPageWire = {
	school: string;
	from: string;
	to: string;
	timeZone: string | null;
	currency: string | null;
	unit: CreditUnit | null;
	count: number;
	pending: [];
	days: Array<{
		date: string;
		count: number;
		credits: number;
		amountCents: number;
		entries: LedgerEntryWire[];
	}>;
};

export const entryOf = (row: LedgerRow): LedgerEntryWire => ({
	event: row.event,
	pending: false,
	localTime: row.localTime,
	member: row.holderKey === null ? null : { key: row.holderKey },
	credits: row.credits,
	amountCents: row.amountCents,
	paymentId: row.paymentId,
	promo: row.promoId === null ? null : { id: row.promoId, code: null },
});

export const ledgerPageOf = (
	rows: readonly LedgerRow[],
	context: {
		school: string;
		from: string;
		to: string;
		menu: {
			timeZone: string;
			currency: string;
			unit: CreditUnit | null;
		} | null;
	},
): LedgerPageWire => {
	const days: LedgerPageWire["days"] = [];
	for (const row of rows) {
		const date = row.event.date;
		let day = days.at(-1);
		if (day?.date !== date) {
			day = { date, count: 0, credits: 0, amountCents: 0, entries: [] };
			days.push(day);
		}
		day.count += 1;
		day.credits += row.credits ?? 0;
		if (row.event.event_type !== "payout.paid")
			day.amountCents += row.amountCents ?? 0;
		day.entries.push(entryOf(row));
	}
	return {
		school: context.school,
		from: context.from,
		to: context.to,
		timeZone: context.menu?.timeZone ?? null,
		currency: context.menu?.currency ?? null,
		unit: context.menu?.unit ?? null,
		count: rows.length,
		pending: [],
		days,
	};
};

export const ledgerRoute = async (
	snapshot: SchoolSnapshot,
	query: URLSearchParams,
): Promise<LedgerPageWire> => {
	if (query.has("promo"))
		throw new ApiError(
			"not_available",
			"Promo redemptions are not in the ledger: no event records a promo code.",
		);
	const { from, to } = dayRange(query);
	if (daysInRange(from, to) > LONGEST_LEDGER_RANGE_DAYS)
		throw new ApiError(
			"bad_request",
			`A page holds at most ${LONGEST_LEDGER_RANGE_DAYS} days.`,
			{ field: "to" },
		);
	const type = oneOf(query, "type", TYPE_FILTERS, false);
	const drill = oneOf(query, "drill", DRILLS, false);
	const events = await snapshot.events();
	const rows: LedgerRow[] = [];
	let cursor: string | null = null;
	do {
		const page = ledgerRows(
			events,
			{ from, to, type, drill },
			cursor,
			PAGE_SIZE,
		);
		rows.push(...page.rows);
		cursor = page.next;
	} while (cursor !== null);
	return ledgerPageOf(rows, {
		school: snapshot.school,
		from,
		to,
		menu: await snapshot.menu(),
	});
};
