import { Effect, Result } from "effect";
import type { Period } from "$contract/app/period.ts";
import type { Disclosure } from "$contract/data/disclosure.ts";
import type { MembersSummary } from "$contract/data/members.ts";
import type { School } from "$contract/data/types.ts";
import { read } from "../effect/run.ts";
import type { UiError } from "../effect/ui-error.ts";
import { resolveViewing } from "./viewing.ts";

/** One school's figures on All schools (mockup `portfolio()`), each shown only to the viewer it may show to: the
 * credits outstanding to an owner or admin (they see the roster), the income to a finance admin or the owner (it is
 * live money). Otherwise the figure is the reason, never a 0. */
export type SchoolFigures = {
	outstanding: { count: number; unit: string } | { hidden: string };
	income: { cents: number; currency: string } | { hidden: string };
};

export const rosterLock = "Owners and admins see the roster";
export const incomeLock = "Finance admins and the owner see this";

/** What the viewer's own audience at the school may read: the roster's summary, the period's income. */
export function viewerReads(disclosure: Disclosure): {
	roster: boolean;
	income: boolean;
} {
	const { option, view } = resolveViewing(disclosure, null);
	return { roster: option.admin, income: view.live };
}

export const schoolFigures = (
	summary: MembersSummary | null,
	income: number | null,
	currency: string | null,
): SchoolFigures => ({
	outstanding: summary
		? { count: summary.creditsOutstanding, unit: summary.unit.other }
		: { hidden: rosterLock },
	income:
		income !== null && currency
			? { cents: income, currency }
			: { hidden: incomeLock },
});

/** The Income total per currency (never summed across currencies), over the schools whose income shows, with the
 * schools it leaves out by reason: one that did not load (failed, or still loading) and one whose income the viewer
 * does not see. Summing on the client is an exception to "nothing is summed or recomputed" (owner decision
 * 2026-11-08, S9-plan D23): no server route serves a cross-school total, so the cells shown are added here, in exact
 * integer minor units, one total per currency. */
export function incomeTotals(figures: ReadonlyArray<SchoolFigures | null>): {
	totals: Array<{ currency: string; cents: number }>;
	leavesOut: { notLoaded: boolean; hidden: boolean };
} {
	const totals = new Map<string, number>();
	const leavesOut = { notLoaded: false, hidden: false };
	for (const figure of figures) {
		if (!figure) {
			leavesOut.notLoaded = true;
			continue;
		}
		if ("hidden" in figure.income) {
			leavesOut.hidden = true;
			continue;
		}
		const { currency, cents } = figure.income;
		totals.set(currency, (totals.get(currency) ?? 0) + cents);
	}
	return {
		totals: [...totals].map(([currency, cents]) => ({ currency, cents })),
		leavesOut,
	};
}

/** A school's cells on All schools: on their way, failed with the error the table's toast reports, or figures. */
export type SchoolShown =
	| { state: "loading" }
	| { state: "failed"; error: UiError }
	| { state: "loaded"; figures: SchoolFigures };

/** One school's figures for the period: its disclosure decides what the viewer reads, then the summary and the
 * income it allows. */
const readSchool = (school: School, { from, to }: Period) =>
	Effect.gen(function* () {
		const may = viewerReads(
			yield* read((reader) => reader.disclosure(school.id)),
		);
		const summary = may.roster
			? yield* read((reader) => reader.membersSummary({ schoolId: school.id }))
			: null;
		const income = may.income
			? yield* read((reader) =>
					reader.membersIncome({ schoolId: school.id, from, to }),
				)
			: null;
		return schoolFigures(summary, income, summary?.currency ?? school.currency);
	});

/** Every school at once, each cell told its own result as it ends (`shown`); the read fails with the first school's
 * error when any school failed, so that the table has one failure toast, whose Retry reads every school again. */
export const readAllSchools = (
	schools: readonly School[],
	period: Period,
	shown: (schoolId: string, next: SchoolShown) => void,
) =>
	Effect.gen(function* () {
		const results = yield* Effect.forEach(
			schools,
			(school) =>
				Effect.result(readSchool(school, period)).pipe(
					Effect.tap((result) =>
						Effect.sync(() =>
							shown(
								school.id,
								Result.isSuccess(result)
									? { state: "loaded", figures: result.success }
									: { state: "failed", error: result.failure },
							),
						),
					),
				),
			{ concurrency: "unbounded" },
		);
		const failed = results.find(Result.isFailure);
		if (failed) return yield* Effect.fail(failed.failure);
	});

/** The note under a partial Income total, naming each reason a school is left out; null when none is. */
export function leavesOutNote(
	leavesOut: { notLoaded: boolean; hidden: boolean },
	anyTotal: boolean,
): string | null {
	const reasons = [
		leavesOut.notLoaded ? "schools that did not load" : null,
		leavesOut.hidden ? "schools whose income you do not see" : null,
	].filter((reason) => reason !== null);
	if (reasons.length === 0) return null;
	return anyTotal ? `Leaves out ${reasons.join(" and ")}` : "Not shown";
}
