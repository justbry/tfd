/**
 * The views job leaves a note under `schools/<id>/views/` when a school's log cannot be replayed, so a request for a
 * school with no views yet can say "the ledger is broken" (503) instead of "no data yet" (404). The note holds the
 * problem's `kind` and the time, never an event id or a holder key (`SummaryProblem.message` carries those).
 */
import { type Store, textOf } from "./store-io.js";

export type JobProblem = { kind: string; at: string };

export const jobStatusKey = (school: string): string =>
	`schools/${school}/views/job.json`;

export const readJobProblem = async (
	store: Store,
	school: string,
): Promise<JobProblem | null> => {
	const text = await textOf(store, jobStatusKey(school));
	if (text === null) return null;
	try {
		const parsed = JSON.parse(text) as {
			ok?: unknown;
			kind?: unknown;
			at?: unknown;
		};
		return parsed.ok === false &&
			typeof parsed.kind === "string" &&
			typeof parsed.at === "string"
			? { kind: parsed.kind, at: parsed.at }
			: null;
	} catch {
		return null;
	}
};
