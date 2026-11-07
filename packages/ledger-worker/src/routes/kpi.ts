/**
 * `GET /v1/schools/:school/kpi`, `.../audience-report` and `.../disclosure`: the KPI document of `atm/worker` for the
 * school's events, at an audience no finer than the caller's. The Worker reads the finance objects (the day-by-day gross)
 * to build the document; what it returns is the audience's document, never what it read.
 */
import {
	type Audience,
	audienceViews,
	type Cell,
	type KpiContributions,
	type KpiDocument,
	type KpiDocumentContext,
	type KpiDocumentRow,
	kpiDocument,
} from "atm/worker";
import { mapLimited } from "../data/concurrency.js";
import { disclosureOf } from "../data/disclosure.js";
import type { SchoolMenu } from "../data/menu.js";
import { type SchoolSnapshot, viewValue } from "../data/snapshot.js";
import { ApiError } from "../http.js";
import { localWallTime } from "../time.js";
import type { AudienceReportWire, ReportCell } from "../wire.js";
import { dayRange, oneOf } from "./query.js";

const READ_CONCURRENCY = 6;
const MONTHS = 12;
const REPORT_AUDIENCES = ["public", "member", "governance"] as const;
const NOT_COMPUTED: Cell = { hidden: "not_computed", text: "Not computed" };
const TIER_PREFIX = "revenue_by_tier:";
const NO_CONTRIBUTIONS: KpiContributions = {};

const monthsOfYear = (year: number): string[] =>
	Array.from(
		{ length: MONTHS },
		(_, index) => `${year}-${String(index + 1).padStart(2, "0")}`,
	);

/** The school's time zone: its menu's, else the last event's, else UTC. */
export const zoneOf = async (snapshot: SchoolSnapshot): Promise<string> =>
	(await snapshot.menu())?.timeZone ??
	(await snapshot.events()).at(-1)?.tz ??
	"UTC";

/** The school's clock for a request at `now`: its local day, and `asOf` as local wall time. */
export const clockOf = async (
	snapshot: SchoolSnapshot,
	now: number,
): Promise<{ today: string; now: string }> => {
	const zone = await zoneOf(snapshot);
	return {
		today: localWallTime(now, zone).slice(0, 10),
		now: localWallTime(Date.parse(snapshot.asOf), zone),
	};
};

/** The plan ids in the menu's tier order, then any plan paid that the menu lacks, by name; absent without a menu. */
export const planOrderOf = (
	menu: SchoolMenu | null,
	rows: readonly KpiDocumentRow[],
): string[] | undefined => {
	if (menu === null) return undefined;
	const seen = new Set(menu.tierIds);
	const extra = [
		...new Set(
			rows
				.filter((row) => row.kpiId.startsWith(TIER_PREFIX))
				.map((row) => row.kpiId.slice(TIER_PREFIX.length)),
		),
	]
		.filter((plan) => !seen.has(plan))
		.sort();
	return [...menu.tierIds, ...extra];
};

/** Gross collected on each day of the year's months, from the finance month objects; zeros for a month with no money. */
const grossByDayOf = async (
	snapshot: SchoolSnapshot,
	year: number,
): Promise<number[][]> =>
	mapLimited(monthsOfYear(year), READ_CONCURRENCY, async (month) => {
		const read = await snapshot.reader.financeMonth(month);
		if (!read.ok && read.error === "not-in-manifest")
			return new Array<number>(
				new Date(Date.UTC(year, Number(month.slice(5, 7)), 0)).getUTCDate(),
			).fill(0);
		return viewValue(read).grossByDay;
	});

export type KpiInputs = {
	rows: KpiDocumentRow[];
	context: KpiDocumentContext;
	year: number;
};

export const kpiInputsOf = async (
	snapshot: SchoolSnapshot,
	now: number,
): Promise<KpiInputs> => {
	const rows = await snapshot.kpiRows();
	const menu = await snapshot.menu();
	const clock = await clockOf(snapshot, now);
	const year = Number(clock.today.slice(0, 4));
	const days = await grossByDayOf(snapshot, year);
	const plans = planOrderOf(menu, rows);
	return {
		rows,
		year,
		context: {
			school: snapshot.school,
			// the books are USD only (a non-USD payment is a `money.skipped` event): a log with no menu is read as USD
			currency: menu?.currency ?? "usd",
			clock,
			days,
			...(plans === undefined ? {} : { plans }),
		},
	};
};

export const kpiRoute = async (
	snapshot: SchoolSnapshot,
	audience: Audience,
	pinLocked: boolean,
	now: number,
): Promise<KpiDocument> => {
	const { rows, context, year } = await kpiInputsOf(snapshot, now);
	return kpiDocument(
		rows,
		// the document does not read contributions (`_contributions`): the objects are not fetched for it
		NO_CONTRIBUTIONS,
		disclosureOf(rows, year),
		audience,
		pinLocked,
		context,
	);
};

export const disclosureRoute = async (
	snapshot: SchoolSnapshot,
	now: number,
) => {
	const rows = await snapshot.kpiRows();
	const clock = await clockOf(snapshot, now);
	const year = Number(clock.today.slice(0, 4));
	const { size, file, override } = disclosureOf(rows, year);
	return {
		school: snapshot.school,
		year,
		size,
		file,
		// no stored override yet (build list group 8): the B4 Uni defaults, which the UI says
		override: null,
		source: "defaults" as const,
		// worded by atm/worker at the school's clock; the adapter adds `viewer` and `viewAs`
		views: audienceViews({ file, override, size, year, clock }),
	};
};

// ---- Reports for the audiences that see a document, not the books.

/** Reports reads the audience's own KPI document: every cell, its rounding and its hidden reasons are the document's. */
export const audienceReportOf = (
	document: KpiDocument,
	audience: (typeof REPORT_AUDIENCES)[number],
	from: string,
): AudienceReportWire => {
	const { grain } = document;
	const table = document.tables[grain];
	if (!table)
		throw new ApiError(
			"views_unavailable",
			`The ${audience} document has no table.`,
		);
	const asked = document.periods.find(
		(period) => period.from <= from && from <= period.to,
	);
	const shown =
		(asked?.state === "shown"
			? asked
			: document.periods.filter(({ state }) => state === "shown").at(-1)) ??
		document.periods[0];
	if (!shown)
		throw new ApiError(
			"views_unavailable",
			`The ${audience} document has no periods.`,
		);
	const cellAt = (kpi: string, period: string): Cell =>
		table.series[kpi]?.[table.periods.indexOf(period)] ?? NOT_COMPUTED;
	const cell = (kpi: string): Cell => cellAt(kpi, shown.period);
	// a school with no booking or discount revenue has no series for it: its line reads 0 where the income does,
	// and whatever withholds the income (delay, minimum payers) withholds the line
	const kindCell = (kpi: string): Cell =>
		table.series[kpi]
			? cell(kpi)
			: typeof cell("gross_collected") === "number"
				? 0
				: cell("gross_collected");
	const year = shown.period.slice(0, 4);
	const strip = document.periods.filter(
		({ period }) => grain === "year" || period.startsWith(year),
	);
	const index = table.periods.indexOf(shown.period);
	const tiers = (table.order?.revenue_by_tier?.[index] ?? []).flatMap((kpi) => {
		const income = cell(kpi);
		return income === 0
			? []
			: [{ name: document.meta[kpi]?.title ?? kpi, income }];
	});
	// the log records no gift certificate liability: governance's line is not computed, the others' is not theirs to see
	const giftsOutstanding: ReportCell =
		audience === "governance"
			? NOT_COMPUTED
			: { hidden: "no_grant", who: "Governance and up" };
	return {
		audience,
		grain,
		periodLabel: shown.label,
		payments: cell("payments_count"),
		periods: strip.map(({ period, label }) => ({
			label,
			income: cellAt("gross_collected", period),
		})),
		figures: {
			memberships: kindCell("revenue_by_kind:membership"),
			bookings: kindCell("revenue_by_kind:booking"),
			discounts: kindCell("revenue_by_kind:discount"),
			income: cell("gross_collected"),
			refunds: cell("refunds"),
			fees: cell("stripe_fees"),
			net: cell("net_income"),
			paidOut: cell("payouts"),
			giftsOutstanding,
		},
		tiers,
		rounding:
			document.roundTo === 0
				? null
				: { unitCents: document.roundTo, size: document.size },
	};
};

export const audienceReportRoute = async (
	snapshot: SchoolSnapshot,
	query: URLSearchParams,
	now: number,
): Promise<AudienceReportWire> => {
	const audience = oneOf(
		query,
		"audience",
		REPORT_AUDIENCES,
		true,
	) as (typeof REPORT_AUDIENCES)[number];
	const { from } = dayRange(query);
	const document = await kpiRoute(snapshot, audience, false, now);
	return audienceReportOf(document, audience, from);
};
