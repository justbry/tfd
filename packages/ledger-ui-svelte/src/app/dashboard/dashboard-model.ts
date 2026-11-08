import { monthName, type Period } from "$contract/app/period.ts";
import type {
	Cell,
	DocumentPeriod,
	KpiDocument,
	TableGrain,
} from "$contract/data/kpi-document.ts";
import { cellAt, figureText, numberAt } from "../books/kpi-cells.ts";
import type { IconName } from "../icons.ts";

/** The Dashboard's data that is not markup (mockup `dashboard()`, `dashAgg`, `dashFull`; the Preact dashboard.tsx):
 * every function reads the document and derives no figure. */

export type DashboardView = "money" | "members" | "risk";
export const dashboardViews: ReadonlyArray<{
	id: DashboardView;
	label: string;
	icon: IconName;
}> = [
	{ id: "money", label: "Money", icon: "coin" },
	{ id: "members", label: "Members", icon: "users" },
	{ id: "risk", label: "Risk", icon: "alert" },
];
export const viewOf = (asked: string | null): DashboardView =>
	dashboardViews.find(({ id }) => id === asked)?.id ?? "money";

/** The mockup's four fixture scenarios (its `Fixture scenario` control) come first in the Reader's list; the others
 * stay reachable by the route's `preset=`, and the control then shows none pressed. */
export const featuredScenarios = 4;
/** Real data has no presets: the query then names none and the Reader answers the school's one document. */
export const noPreset = "";

/** The mockup's tones and "Needs a look": a refund rate over 10% or 3 disputes or more; over 20% or 5 is severe. */
export const refundRateBad = 0.1;
const refundRateWarn = 0.05;
const refundRateSevere = 0.2;
const disputesBad = 3;
const disputesSevere = 5;
/** The month's dispute cost in minor units: over $50 bad, any cost a warning. */
const disputeCostBad = 5000;
export const openMonthTitle = "Open month: live, can still change";

export type Tone = "ok" | "warn" | "bad" | "";
export function refundTone(rate: number | null): Tone {
	if (rate === null) return "";
	if (rate > refundRateBad) return "bad";
	if (rate > refundRateWarn) return "warn";
	return "ok";
}
/** The Refunds card on a month is toned only once the rate passes 5%. */
export const refundCardTone = (rate: number | null): Tone =>
	rate !== null && rate > refundRateWarn ? refundTone(rate) : "";
export function disputeTone(disputes: number | null): Tone {
	if (disputes === null) return "";
	if (disputes >= disputesBad) return "bad";
	return disputes >= 1 ? "warn" : "ok";
}
export function disputeCostTone(cost: number | null): Tone {
	if (cost === null) return "";
	if (cost > disputeCostBad) return "bad";
	return cost > 0 ? "warn" : "ok";
}

/** `Jun` for a month, `Q2 2026` for a quarter, `2024` for a year. */
export function shortPeriodName(period: string): string {
	const [year = "", part] = period.split("-");
	if (part === undefined) return year;
	if (part.startsWith("Q")) return `${part} ${year}`;
	return monthName(`${period}-01`);
}

/** "A", "A and B", "A, B and C". */
export function namesList(names: readonly string[]): string {
	const last = names.at(-1) ?? "";
	return names.length < 2
		? last
		: `${names.slice(0, -1).join(", ")} and ${last}`;
}

export const seriesStartingWith = (
	document: KpiDocument,
	grain: TableGrain,
	prefix: string,
): string[] =>
	Object.keys(document.tables[grain]?.series ?? {}).filter((kpi) =>
		kpi.startsWith(prefix),
	);

/** The periods of a table that fall in the selected period's year; every year for the year table. */
export function periodsOf(
	document: KpiDocument,
	selected: DocumentPeriod,
	grain: TableGrain,
): string[] {
	const year = selected.period.slice(0, 4);
	return (document.tables[grain]?.periods ?? []).filter(
		(period) => grain === "year" || period.startsWith(`${year}-`),
	);
}

/** The strip period the route shows (mockup `snapP`): the route's period when the audience may pick it, else the last
 * pickable one that ends on or before it, else the first pickable one. */
export function snapStripPeriod(
	periods: readonly DocumentPeriod[],
	asked: Period,
): DocumentPeriod | undefined {
	const pickable = periods.filter(({ state }) => state === "shown");
	return (
		pickable.find(({ from, to }) => from === asked.from && to === asked.to) ??
		pickable.filter(({ to }) => to <= asked.to).at(-1) ??
		pickable[0] ??
		periods[0]
	);
}

/** The route's `month=` for a strip period: `YYYY-MM` at the month grain, else the period's dates. */
export const monthParameter = (
	document: KpiDocument,
	period: DocumentPeriod,
): string =>
	document.grain === "month" ? period.period : `${period.from}..${period.to}`;

/** A card whose figure is withheld says why instead of its sub-line (mockup `kcard`); null when it is shown. */
export function withheldLine(cell: Cell | undefined): string | null {
	if (cell === undefined || typeof cell === "number" || !("hidden" in cell))
		return null;
	if (cell.hidden === "suppressed") return cell.text;
	if (cell.hidden === "embargoed") return "Inside its delay";
	if (cell.hidden === "members_only" || cell.hidden === "no_grant")
		return "Not in this document";
	return null;
}

/** The sub-line of a month card (mockup `dlt`): "First month", "Same as May", or "▲ $6 vs May" with the change the
 * document carries (`KpiTable.changes`); a change that is no figure says nothing (null). */
export function changeText(
	document: KpiDocument,
	selected: DocumentPeriod,
	kpi: string,
): string | null {
	const table = document.tables.month;
	const index = table?.periods.indexOf(selected.period) ?? -1;
	if (!table || index < 0) return null;
	if (index === 0) return "First month";
	const change = table.changes?.[kpi]?.[index];
	if (change === undefined || change === null) return null;
	const before = monthName(`${table.periods[index - 1]}-01`);
	if (change === 0) return `Same as ${before}`;
	const format =
		document.meta[kpi]?.format === "integer" ? "integer" : "money0";
	return `${change > 0 ? "▲" : "▼"} ${figureText(Math.abs(change), format, document.symbol)} vs ${before}`;
}

/** A suppressed cell's text is "Hidden: <why>"; its reason line names the row before the why. */
const hiddenPrefix = /^Hidden: /;

/** The reason line under a breakdown (mockup `kwhyHtml`): "<row>: <why>" for every row the cell rules hid or
 * rounded. */
export function reasonsOf(
	document: KpiDocument,
	selected: DocumentPeriod,
	kpis: readonly string[],
): string[] {
	return kpis.flatMap((kpi) => {
		const cell = cellAt(document, kpi, selected.period);
		const title = document.meta[kpi]?.title;
		if (cell === undefined || typeof cell === "number") return [];
		if ("hidden" in cell)
			return cell.hidden === "suppressed"
				? [`${title}: ${cell.text.replace(hiddenPrefix, "")}`]
				: [];
		return cell.why ? [`${title}: ${cell.why}`] : [];
	});
}

/** A "Needs a look" row: a month with a refund rate over 10% or 3 disputes or more. */
export type Flag = {
	period: string;
	severe: boolean;
	highRate: boolean;
	manyDisputes: boolean;
};
export function flagsOf(
	document: KpiDocument,
	selected: DocumentPeriod,
): Flag[] {
	return periodsOf(document, selected, "month").flatMap((period) => {
		const rate = numberAt(document, "refund_rate", period);
		const disputes = numberAt(document, "disputes_opened", period);
		const highRate = rate !== null && rate > refundRateBad;
		const manyDisputes = disputes !== null && disputes >= disputesBad;
		if (!highRate && !manyDisputes) return [];
		const severe =
			(highRate && rate > refundRateSevere) ||
			(manyDisputes && disputes >= disputesSevere);
		return [{ period, severe, highRate, manyDisputes }];
	});
}

/** "<title> by <grain>": the heading of a series. */
export const seriesHeading = (
	document: KpiDocument,
	kpi: string,
	title: string,
): string => `${title} by ${document.meta[kpi]?.every ?? document.grain}`;

/** The year table's sum of the four rounded quarters, which the Member's year note names. */
export const quartersKpi = "gross_collected_rounded_quarters";

/** "Credits", "Sessions": the school's credit unit as a heading. */
export const creditsName = (other: string): string =>
	`${other.charAt(0).toUpperCase()}${other.slice(1)}`;

/** What every part of the pane reads: the document, the strip period on screen, and how to open a period. */
export type Books = {
	document: KpiDocument;
	selected: DocumentPeriod;
	choose: (period: string) => void;
};

/** A chart's series: a KPI, its name in the legend and the tooltip, its colour. */
export type ChartSeries = { kpi: string; name: string; color: string };

export const chartColors = [
	"var(--chart-1)",
	"var(--chart-2)",
	"var(--chart-3)",
	"var(--chart-4)",
	"var(--chart-5)",
] as const;
/** The mockup's `KGROSS`: gross behind net, a translucent grey. */
export const grossColor = "rgba(138, 138, 150, 0.5)";
