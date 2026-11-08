import type { Disclosure } from "$contract/data/disclosure.ts";
import type { MembersSummary } from "$contract/data/members.ts";
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

/** The Income total per currency (never summed across currencies), over the schools whose income shows; `partial` when
 * a school's income does not show, so the total says it leaves that school out. */
export function incomeTotals(figures: ReadonlyArray<SchoolFigures | null>): {
	totals: Array<{ currency: string; cents: number }>;
	partial: boolean;
} {
	const totals = new Map<string, number>();
	let partial = false;
	for (const figure of figures) {
		if (!figure || "hidden" in figure.income) {
			partial = true;
			continue;
		}
		const { currency, cents } = figure.income;
		totals.set(currency, (totals.get(currency) ?? 0) + cents);
	}
	return {
		totals: [...totals].map(([currency, cents]) => ({ currency, cents })),
		partial,
	};
}
