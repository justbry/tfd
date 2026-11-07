import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalize } from "../../atm/src/ledger/util.ts";
import type { mountApp } from "../src/app/mount.tsx";
import type { Audience } from "../src/data/disclosure.ts";
import {
	type Cell,
	cellKind,
	type KpiDocument,
	type KpiFormat,
	type KpiQuery,
	type KpiTable,
	type TableGrain,
} from "../src/data/kpi-document.ts";
import type { Reader } from "../src/data/reader.ts";
import type { Clock } from "../src/data/types.ts";
import type { Writer } from "../src/data/writer.ts";

/**
 * The parts of gate C (test/consistency.test.ts) that take any `Reader`: C3's "the Reader answers exactly these
 * documents" and C4's mount of the Dashboard on a document, every view and every shown period, checked cell by cell
 * against the document. The fixture Reader runs them in test/consistency.test.ts, the HTTP Reader on the real ledger
 * Worker in test/worker-e2e/consistency-http.test.ts.
 */

export type DashboardView = "money" | "members" | "risk";
export const dashboardViews: readonly DashboardView[] = [
	"money",
	"members",
	"risk",
];
/** The KPIs each Dashboard view must render for its selected period, per audience (test/golden/S1.json `views`). */
const viewKpis = (
	JSON.parse(
		readFileSync(join(import.meta.dir, "golden", "S1.json"), "utf8"),
	) as { views: Record<Audience, Record<DashboardView, string[]>> }
).views;

/** The mockup's `kusd`, `kusd0` and `kpct`, and String for counts (kpi-document.ts `KpiFormat`). */
const money = (cents: number, symbol: string, decimals: boolean): string =>
	`${cents < 0 ? "−" : ""}${symbol}${
		decimals
			? (Math.abs(cents) / 100).toLocaleString("en-US", {
					minimumFractionDigits: 2,
					maximumFractionDigits: 2,
				})
			: Math.round(Math.abs(cents) / 100).toLocaleString("en-US")
	}`;
const isMoney = (format: KpiFormat): boolean =>
	format === "money" || format === "money0";
const cellText = (cell: Cell, format: KpiFormat, symbol: string): string => {
	if (typeof cell === "number") {
		if (isMoney(format)) return money(cell, symbol, format === "money");
		if (format === "percent1") return `${(cell * 100).toFixed(1)}%`;
		return String(cell);
	}
	if ("lt" in cell)
		return isMoney(format)
			? `under ${money(cell.lt, symbol, false)}`
			: `<${cell.lt}`;
	if ("approx" in cell) return String(cell.approx);
	return cell.hidden === "suppressed" ? "—" : cell.text;
};
const cellTitle = (cell: Cell): string | null => {
	if (typeof cell === "number") return null;
	if ("hidden" in cell)
		return cell.hidden === "future" ||
			cell.hidden === "locked" ||
			cell.hidden === "not_computed"
			? null
			: cell.text;
	return cell.why ? `Rounded to the nearest 10: ${cell.why}` : null;
};
const grainOfPeriod = (period: string): TableGrain =>
	/^\d{4}$/.test(period)
		? "year"
		: /-Q\d$/.test(period)
			? "quarter"
			: /^\d{4}-\d{2}$/.test(period)
				? "month"
				: "day";
const monthParameter = (document: KpiDocument, period: string): string => {
	const found = document.periods.find((entry) => entry.period === period);
	if (!found) return period;
	return document.grain === "month" ? period : `${found.from}..${found.to}`;
};
const dashboardRoute = (
	document: KpiDocument,
	view: DashboardView,
	period: string,
): string =>
	`#/${document.school}/dashboard?${document.source.kind === "mart" ? `preset=${document.source.preset}&` : ""}as=${document.audience}${document.pinLocked ? "&pin=locked" : ""}&view=${view}&month=${monthParameter(document, period)}`;
/** The KPIs the view must render for the selected period (S1.json `views`); the donor rows only once a donor shows,
 * the funds that have a gift, every day of the month on the live audiences' Money view. */
const requiredKpis = (
	document: KpiDocument,
	view: DashboardView,
	period: string,
): Array<{ selector: string; what: string }> => {
	if (document.empty || document.pinLocked) return [];
	const table = document.tables[grainOfPeriod(period)];
	if (!table) return [];
	const index = table.periods.indexOf(period);
	const donors = table.series.donors_count?.[index];
	const showsDonors = typeof donors === "number" && donors > 0;
	const ids = viewKpis[document.audience][view].flatMap((id) => {
		const listed = id.endsWith(":*")
			? Object.keys(table.series).filter((kpi) =>
					kpi.startsWith(id.slice(0, -1)),
				)
			: id in table.series
				? [id]
				: [];
		return listed.filter((kpi) => {
			if (kpi.startsWith("donors_")) return showsDonors;
			if (kpi.startsWith("donations_by_fund:"))
				return (table.order?.donations_by_fund?.[index] ?? []).includes(kpi);
			return true;
		});
	});
	const cells = ids.map((kpi) => ({
		selector: `[data-kpi="${kpi}"][data-period="${period}"]`,
		what: `${kpi}@${period}`,
	}));
	const days =
		view === "money" && document.live
			? (document.tables.day?.periods ?? [])
					.filter((day) => day.startsWith(`${period}-`))
					.map((day) => ({
						selector: `[data-kpi="gross_collected"][data-day="${day}"]`,
						what: `gross_collected@${day}`,
					}))
			: [];
	return [...cells, ...days];
};
const macrotask = (): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, 0));
/** Waits for the app to report the hash it rendered (protocol §3), then two more turns as the golden runner does. */
const settle = async (root: HTMLElement): Promise<boolean> => {
	for (
		let attempt = 0;
		attempt < 400 && root.dataset.route !== window.location.hash;
		attempt += 1
	)
		await macrotask();
	await macrotask();
	await macrotask();
	return root.dataset.route === window.location.hash;
};
const normalize = (text: string | null): string =>
	(text ?? "").replace(/\s+/g, " ").trim();
const checkRender = (
	root: HTMLElement,
	document: KpiDocument,
	view: DashboardView,
	period: string,
	hash: string,
): string[] => {
	const problems: string[] = [];
	const lookup = (table: KpiTable | undefined, kpi: string, at: string) => {
		const index = table?.periods.indexOf(at) ?? -1;
		return index < 0 ? undefined : table?.series[kpi]?.[index];
	};
	for (const element of root.querySelectorAll(
		"[data-kpi][data-period]:not([data-day])",
	)) {
		const kpi = element.getAttribute("data-kpi") ?? "";
		const at = element.getAttribute("data-period") ?? "";
		const cell = lookup(document.tables[grainOfPeriod(at)], kpi, at);
		const meta = document.meta[kpi];
		if (cell === undefined || !meta) {
			problems.push(`${hash}: ${kpi}@${at} is not in the document`);
			continue;
		}
		const expected = {
			cell: cellKind(cell),
			text: cellText(cell, meta.format, document.symbol),
			...(cellTitle(cell) ? { title: cellTitle(cell) } : {}),
		};
		const rendered = {
			cell: element.getAttribute("data-cell"),
			text: normalize(element.textContent),
			...("title" in expected ? { title: element.getAttribute("title") } : {}),
		};
		if (JSON.stringify(expected) !== JSON.stringify(rendered))
			problems.push(
				`${hash}: ${kpi}@${at} rendered ${JSON.stringify(rendered)}, the document has ${JSON.stringify(expected)}`,
			);
	}
	for (const element of root.querySelectorAll("[data-kpi][data-day]")) {
		const kpi = element.getAttribute("data-kpi") ?? "";
		const day = element.getAttribute("data-day") ?? "";
		const cell = lookup(document.tables.day, kpi, day);
		if (cell === undefined) {
			problems.push(`${hash}: ${kpi}@${day} is not in the document`);
			continue;
		}
		const expected = {
			cell: cellKind(cell),
			...(typeof cell === "number" ? { value: String(cell) } : {}),
		};
		const rendered = {
			cell: element.getAttribute("data-cell"),
			...("value" in expected
				? { value: element.getAttribute("data-value") }
				: {}),
		};
		if (JSON.stringify(expected) !== JSON.stringify(rendered))
			problems.push(
				`${hash}: ${kpi}@${day} rendered ${JSON.stringify(rendered)}, the document has ${JSON.stringify(expected)}`,
			);
	}
	for (const { selector, what } of requiredKpis(document, view, period))
		if (!root.querySelector(selector))
			problems.push(`${hash}: ${what} is not rendered`);
	return problems;
};

/** C3 for any Reader: each query's document is exactly the expected one. Answers one problem per mismatch. */
export async function documentProblems(
	reader: Pick<Reader, "kpiDocument">,
	cases: ReadonlyArray<{ key: string; query: KpiQuery; expected: KpiDocument }>,
): Promise<string[]> {
	const problems: string[] = [];
	for (const { key, query, expected } of cases) {
		const answered = await reader.kpiDocument(query);
		if (canonicalize(answered) !== canonicalize(expected))
			problems.push(
				`${key}: the Reader's document differs from the expected one`,
			);
	}
	return problems;
}

/** C4 for one document on any Reader: mounts the app on the document's Dashboard and renders every view of every
 * shown period, each checked against the document. A document with no shown period renders nothing. */
export async function dashboardProblems(
	adapters: {
		mount: typeof mountApp;
		reader: Reader;
		writer: Writer;
		clock: Clock;
	},
	expected: KpiDocument,
): Promise<{ problems: string[]; renders: number }> {
	const problems: string[] = [];
	let renders = 0;
	const shown = expected.periods
		.filter((period) => period.state === "shown")
		.map((period) => period.period);
	if (shown.length === 0) return { problems, renders };
	window.location.hash = dashboardRoute(expected, "money", shown[0] ?? "");
	const root = document.createElement("div");
	root.id = "app";
	document.body.appendChild(root);
	const app = adapters.mount(root, {
		reader: adapters.reader,
		writer: adapters.writer,
		clock: adapters.clock,
	});
	try {
		for (const view of dashboardViews)
			for (const period of shown) {
				const hash = dashboardRoute(expected, view, period);
				window.location.hash = hash;
				renders += 1;
				if (!(await settle(root))) {
					problems.push(
						`${hash}: the app reported ${root.dataset.route ?? "no route"}`,
					);
					continue;
				}
				if (
					!window.location.hash.startsWith(`#/${expected.school}/dashboard?`)
				) {
					problems.push(
						`${hash}: the app opened ${window.location.hash} instead`,
					);
					continue;
				}
				problems.push(...checkRender(root, expected, view, period, hash));
			}
	} finally {
		app.unmount();
		root.remove();
		window.location.hash = "";
	}
	return { problems, renders };
}
