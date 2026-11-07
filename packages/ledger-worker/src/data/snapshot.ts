/**
 * One school's views generation, opened for a request: the manifest (so `asOf`), the verified view readers, and the
 * things worked out from the event log (the events up to `asOf`, the menu, the KPI rows), each once per generation and
 * kept in the isolate while the manifest stays the same.
 */

import type { AtmEvent } from "tfd";
import {
	atmChannel,
	evaluateKpis,
	isExportableKpiId,
	type Kpi,
	type KpiDocumentRow,
	periodsFrom,
	readEventsFromStore,
	readViewsFromStore,
	SCHOOL_KPI_SPEC,
	type ViewRead,
} from "tfd/worker";
import { ApiError } from "../http.js";
import { localWallTime } from "../time.js";
import { readJobProblem } from "./job-status.js";
import { latestMenu, type SchoolMenu } from "./menu.js";
import type { Store } from "./store-io.js";

const RETRY_AFTER_SECONDS = 5;
const KEPT_GENERATIONS = 4;
const CREDIT_EVENT = /^credit\./;
const MONEY_EVENT = /^(payment|dispute|payout)\./;

/** The KPIs `reads` marks as reading something: base ones by their compute, derived ones when any input is. */
const kpisReading = (
	reads: (compute: Kpi["compute"]) => boolean,
): ReadonlySet<string> => {
	const ids = new Set<string>();
	for (const kpi of SCHOOL_KPI_SPEC.kpis) {
		const { compute } = kpi;
		const marked =
			compute.op === "ratio"
				? ids.has(compute.num) || ids.has(compute.den)
				: compute.op === "combine"
					? compute.terms.some((term) => ids.has(term.kpi))
					: reads(compute);
		if (marked) ids.add(kpi.id);
	}
	return ids;
};

/** The KPIs that need credit events: the credit-commodity sums, and the ratios and combinations that read them. */
const CREDIT_KPIS = kpisReading(
	(compute) => compute.op === "sum" && compute.commodity === "credits",
);
/** The KPIs that need the school's money: the USD sums, the counts of payment, dispute and payout events, and what reads them. */
const MONEY_KPIS = kpisReading(
	(compute) =>
		(compute.op === "sum" && compute.commodity === "usd") ||
		((compute.op === "count" || compute.op === "distinct") &&
			(compute.where.eventType ?? []).some((type) => MONEY_EVENT.test(type))),
);

const skippedNonUsd = (event: AtmEvent): boolean =>
	event.event_type === "money.skipped" && event.payload.reason === "non_usd";

/**
 * The KPI export rows of `events`: the school spec folded by the atm channel over every month from the first event to
 * `through` (a cumulative KPI needs them all), without the rows that name a holder. A KPI the log cannot answer has no
 * row, so its cell reads "not computed" instead of 0: the credit KPIs when the log holds no credit event (phase 1 of the
 * emission, D12), and the money KPIs when the log skipped money in another currency (the books are USD only).
 */
export const kpiRowsOf = (
	events: readonly AtmEvent[],
	through: string,
): KpiDocumentRow[] => {
	const first = events[0]?.date.slice(0, 7);
	if (first === undefined) return [];
	const [fromYear = 0, fromMonth = 1] = first.split("-").map(Number);
	const [toYear = 0, toMonth = 1] = through.split("-").map(Number);
	const count = (toYear - fromYear) * 12 + (toMonth - fromMonth) + 1;
	if (count < 1) return [];
	const periods = periodsFrom(first, count);
	const rows = evaluateKpis({
		spec: SCHOOL_KPI_SPEC,
		base: atmChannel.base({ events, spec: SCHOOL_KPI_SPEC, periods }),
		periods,
	});
	const unknown = new Set<string>();
	if (!events.some((event) => CREDIT_EVENT.test(event.event_type)))
		for (const id of CREDIT_KPIS) unknown.add(id);
	if (events.some(skippedNonUsd)) for (const id of MONEY_KPIS) unknown.add(id);
	return rows
		.filter(
			(row) =>
				isExportableKpiId(row.kpiId) &&
				!unknown.has(row.kpiId.split(":")[0] as string),
		)
		.map(({ kpiId, period, unit, value }) => ({ kpiId, period, unit, value }));
};

type Derived = {
	events: Promise<AtmEvent[]>;
	menu: Promise<SchoolMenu | null>;
	rows: Promise<KpiDocumentRow[]>;
};

const generations = new Map<string, Derived>();

export type SchoolSnapshot = {
	school: string;
	reader: Extract<Awaited<ReturnType<typeof readViewsFromStore>>, { ok: true }>;
	/** The manifest's `asOf`. */
	asOf: string;
	events: () => Promise<AtmEvent[]>;
	menu: () => Promise<SchoolMenu | null>;
	/** The month (`YYYY-MM`) of `asOf` in the school's time zone, which bounds the KPI periods. */
	kpiRows: () => Promise<KpiDocumentRow[]>;
};

/** A view read that gave no value, as the error it is: a run in flight (409) or an object the manifest does not list (404). */
export const viewValue = <Value>(read: ViewRead<Value>): Value => {
	if (read.ok) return read.value;
	if (read.error === "view-mismatch")
		throw new ApiError(
			"view_mismatch",
			"The views are being rewritten; try again.",
			{ retryAfterSeconds: RETRY_AFTER_SECONDS },
		);
	if (read.error === "not-in-manifest")
		throw new ApiError("not_found", "No such object in this school's views.");
	throw new ApiError("views_unavailable", "The school's views cannot be read.");
};

const eventsUpTo = (events: AtmEvent[], asOf: string): AtmEvent[] => {
	const limit = Date.parse(asOf);
	return events.filter((event) => Date.parse(event.event_time) <= limit);
};

/**
 * Opens the school's views, or throws the `ApiError` that answers for it: `no_data` (404) before a first run,
 * `views_unavailable` (503) when the job has left a note that the log cannot be replayed or the manifest is unreadable.
 */
export const openSnapshot = async (
	store: Store,
	school: string,
): Promise<SchoolSnapshot> => {
	const reader = await readViewsFromStore(store, school);
	if (!reader.ok) {
		if (reader.error === "bad-manifest")
			throw new ApiError(
				"views_unavailable",
				"The school's views cannot be read.",
			);
		const problem = await readJobProblem(store, school);
		if (problem !== null)
			throw new ApiError(
				"views_unavailable",
				`The school's log cannot be replayed (${problem.kind}).`,
			);
		throw new ApiError("no_data", "No ledger data yet.");
	}
	const { asOf, generatedFrom } = reader.manifest;
	const key = `${school}|${asOf}|${generatedFrom.lastEventId}|${generatedFrom.eventCount}`;
	let derived = generations.get(key);
	if (derived === undefined) {
		const events = readEventsFromStore(store, school).then((all) =>
			eventsUpTo(all, asOf),
		);
		const menu = events.then(latestMenu);
		const rows = Promise.all([events, menu]).then(([list, found]) => {
			const zone = found?.timeZone ?? list.at(-1)?.tz ?? "UTC";
			return kpiRowsOf(list, localWallTime(Date.parse(asOf), zone).slice(0, 7));
		});
		derived = { events, menu, rows };
		// a failed read is not kept: the next request reads again
		for (const promise of [events, menu, rows])
			promise.catch(() => generations.delete(key));
		generations.set(key, derived);
		while (generations.size > KEPT_GENERATIONS) {
			const oldest = generations.keys().next().value;
			if (oldest === undefined) break;
			generations.delete(oldest);
		}
	}
	const kept = derived;
	return {
		school,
		reader,
		asOf,
		events: () => kept.events,
		menu: () => kept.menu,
		kpiRows: () => kept.rows,
	};
};

export const forgetGenerations = (): void => generations.clear();
