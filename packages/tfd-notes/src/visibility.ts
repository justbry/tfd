// SPDX-License-Identifier: Apache-2.0
/**
 * What a reader outside the two parties may see (plan decision D1). The ceiling: negative events never leave the two
 * parties. A shared view is built only from what both views count identically, so a dispute, an unanswered claim, a
 * counter-amount, a notice or an annotation leaves no trace in it, and a reader cannot tell one happened. Pure
 * functions of the events and a date.
 */

import { compareDates } from "./date";
import type { Grant } from "./grants";
import { agreedView } from "./statement";
import type {
	Balance,
	CivilDate,
	GrantAudience,
	GrantLevel,
	ScheduleRow,
} from "./types";

/** The label every list of agreed payments carries. */
export const AGREED_PAYMENTS_LABEL = "recorded and counted by both parties";

/** Higher ranks see more. A `link` audience is capped at `verify`. */
const LEVEL_RANK: Record<GrantLevel, number> = {
	verify: 0,
	summary: 1,
	statement: 2,
};

/** `verify`: a check that a signed document belongs to this note, and nothing about money, state or parties. */
export interface VerifyView {
	note_id: string;
	level: "verify";
}

export interface SummaryView {
	note_id: string;
	level: "summary";
	as_of: CivilDate;
	currency: string;
	exponent: number;
	status: "open" | "closed";
	principal_minor: string;
	interest_minor: string;
	payoff_minor: string;
	/** Installments in the schedule. */
	schedule_length: number;
	/** The first scheduled due date after `as_of`, from the schedule alone; null when none is left. */
	next_installment_due: CivilDate | null;
}

export interface SharedPayment {
	/** 1-based position in the list; the event id stays private. */
	index: number;
	value_date: CivilDate;
	amount_minor: string;
	kind: "payment" | "reversal";
}

export interface StatementView extends Omit<SummaryView, "level"> {
	level: "statement";
	schedule: ScheduleRow[];
	payments: {
		label: typeof AGREED_PAYMENTS_LABEL;
		items: SharedPayment[];
	};
}

export type SharedView = VerifyView | SummaryView | StatementView;

/** The balance over only the payments both views count identically on `asOf`. */
export const agreedBalance = (events: unknown[], asOf: CivilDate): Balance =>
	agreedView(events, asOf).balance;

const nextInstallmentDue = (
	schedule: ScheduleRow[],
	asOf: CivilDate,
): CivilDate | null => {
	for (const row of schedule) {
		if (compareDates(row.due, asOf) > 0) {
			return row.due;
		}
	}
	return null;
};

/**
 * What a reader at `level` may see on `asOf`. `verify` carries no figures at all; `summary` the agreed balance and the
 * schedule's length and next due date; `statement` adds the schedule rows and the agreed payments. Throws when the
 * stream is invalid or `asOf` is before the issue date.
 */
export const sharedView = (
	events: unknown[],
	level: GrantLevel,
	asOf: CivilDate,
): SharedView => {
	const agreed = agreedView(events, asOf);
	if (level === "verify") {
		return { note_id: agreed.note_id, level };
	}
	const summary: SummaryView = {
		note_id: agreed.note_id,
		level: "summary",
		as_of: asOf,
		currency: agreed.currency,
		exponent: agreed.exponent,
		status: agreed.closed ? "closed" : "open",
		principal_minor: agreed.balance.principal_minor,
		interest_minor: agreed.balance.interest_minor,
		payoff_minor: agreed.balance.payoff_minor,
		schedule_length: agreed.schedule.length,
		next_installment_due: nextInstallmentDue(agreed.schedule, asOf),
	};
	if (level === "summary") {
		return summary;
	}
	return {
		...summary,
		level,
		schedule: agreed.schedule,
		payments: {
			label: AGREED_PAYMENTS_LABEL,
			items: agreed.payments.map((payment, position) => ({
				index: position + 1,
				value_date: payment.value_date,
				amount_minor: payment.amount_minor,
				kind: payment.kind,
			})),
		},
	};
};

/**
 * The view `audience` may read: the highest level among its active grants (matched by kind and ref), or null when it
 * has none. `grants` comes from `grantsOf` at the instant of the read; only `active` ones count. A `link` audience
 * only ever gets `verify`, whatever level a grant names.
 */
export const viewFor = (
	events: unknown[],
	grants: Grant[],
	audience: GrantAudience,
	asOf: CivilDate,
): SharedView | null => {
	let highest: GrantLevel | null = null;
	for (const grant of grants) {
		if (
			grant.status !== "active" ||
			grant.audience.kind !== audience.kind ||
			grant.audience.ref !== audience.ref
		) {
			continue;
		}
		const level: GrantLevel = audience.kind === "link" ? "verify" : grant.level;
		if (highest === null || LEVEL_RANK[level] > LEVEL_RANK[highest]) {
			highest = level;
		}
	}
	return highest === null ? null : sharedView(events, highest, asOf);
};
