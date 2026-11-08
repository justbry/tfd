import {
	type Cell,
	type CellKind,
	cellKind,
	type HiddenKind,
	type KpiDocument,
	type KpiFormat,
	type TableGrain,
} from "$contract/data/kpi-document.ts";

/**
 * A KPI document's cells as the books panes write them (the Preact package's kpi-cell.tsx, which imports Preact and so
 * is ported here; test/s9-1 compares the two on every cell of every document). The UI formats a cell from the
 * document's `meta` and derives no number: a hidden, missing or banded cell is never written as 0.
 */

const minorUnitsPerUnit = 100;
const percent = 100;
/** What a suppressed cell reads (cell-rules `labels.suppressed`); its reason is its title. */
export const suppressedText = "—";

/** A figure as the document's contract writes it (`KpiFormat`): money with "−" (U+2212) for a negative and the
 * document's symbol, en-US grouping, two decimals or whole units; a count as its plain number; a rate to one decimal. */
export function figureText(
	value: number,
	format: KpiFormat,
	symbol: string,
): string {
	if (format === "integer") return String(value);
	if (format === "percent1") return `${(value * percent).toFixed(1)}%`;
	const whole = format === "money0";
	const units = Math.abs(value) / minorUnitsPerUnit;
	const written = (whole ? Math.round(units) : units).toLocaleString("en-US", {
		minimumFractionDigits: whole ? 0 : 2,
		maximumFractionDigits: whole ? 0 : 2,
	});
	return `${value < 0 ? "−" : ""}${symbol}${written}`;
}

const isMoney = (format: KpiFormat): boolean =>
	format === "money" || format === "money0";

/** A cell's text: a number, `<10` or "under $100" for `lt`, the rounded count of `approx`, and for a hidden cell its
 * own text, "—" when the cell rules suppress it. */
export function cellText(
	document: KpiDocument,
	kpi: string,
	cell: Cell,
): string {
	const format = document.meta[kpi]?.format ?? "integer";
	if (typeof cell === "number")
		return figureText(cell, format, document.symbol);
	if ("lt" in cell)
		return isMoney(format)
			? `under ${figureText(cell.lt, "money0", document.symbol)}`
			: `<${cell.lt}`;
	if ("approx" in cell) return String(cell.approx);
	return cell.hidden === "suppressed" ? suppressedText : cell.text;
}

/** The hidden kinds that keep a figure from an audience: their cells say why, with the clock or the lock. */
export const withheldKinds: ReadonlySet<HiddenKind> = new Set([
	"embargoed",
	"members_only",
	"no_grant",
]);

/** What a KPI the table lacks reads: never a 0. */
export const notComputedCell: Cell = {
	hidden: "not_computed",
	text: "Not computed",
};

/** The table a period belongs to: `YYYY`, `YYYY-Qn`, `YYYY-MM` or `YYYY-MM-DD`. */
export function grainOf(period: string): TableGrain {
	if (/^\d{4}$/.test(period)) return "year";
	if (/-Q\d$/.test(period)) return "quarter";
	if (/^\d{4}-\d{2}$/.test(period)) return "month";
	return "day";
}

/** The cell of a KPI in a period, from the table of that period's grain; undefined when the document has none. */
export function cellAt(
	document: KpiDocument,
	kpi: string,
	period: string,
): Cell | undefined {
	const table = document.tables[grainOf(period)];
	const index = table?.periods.indexOf(period) ?? -1;
	return index < 0 ? undefined : table?.series[kpi]?.[index];
}

/** The cell's number, or null: a band or a hidden cell is never drawn, and never as 0. */
export function numberAt(
	document: KpiDocument,
	kpi: string,
	period: string,
): number | null {
	const cell = cellAt(document, kpi, period);
	return typeof cell === "number" ? cell : null;
}

/** How one cell is shown: its kind (`data-cell`), its text, why it is not a plain figure (its title), and how it is
 * drawn: `withheld` with the clock or the lock, `suppressed` greyed, `rounded` dotted. */
export type ShownCell = {
	kind: CellKind;
	text: string;
	title: string | null;
	look: "plain" | "withheld" | "suppressed" | "rounded";
	/** For a withheld cell, its hidden kind (`data-hid`). */
	withheld: HiddenKind | null;
};

/** The one reading of a cell every books surface uses. A hidden cell's title is its text; a count the rules round
 * is "Rounded to the nearest 10: <why>"; a `future`, `locked` or `not_computed` cell has none. */
export function showCell(
	document: KpiDocument,
	kpi: string,
	cell: Cell,
): ShownCell {
	const kind = cellKind(cell);
	const text = cellText(document, kpi, cell);
	if (typeof cell === "number")
		return { kind, text, title: null, look: "plain", withheld: null };
	if ("hidden" in cell) {
		if (cell.hidden === "suppressed")
			return {
				kind,
				text,
				title: cell.text,
				look: "suppressed",
				withheld: null,
			};
		if (withheldKinds.has(cell.hidden))
			return {
				kind,
				text,
				title: cell.text,
				look: "withheld",
				withheld: cell.hidden,
			};
		return { kind, text, title: null, look: "plain", withheld: null };
	}
	if (cell.why)
		return {
			kind,
			text,
			title: `Rounded to the nearest 10: ${cell.why}`,
			look: "rounded",
			withheld: null,
		};
	return { kind, text, title: null, look: "plain", withheld: null };
}
