/**
 * The cron job: for every school prefix in the bucket, `runViews` (read the log, build the views as of `asOf`, write them).
 * A school whose run fails does not stop the others. A failure is logged by school id only: the job's own messages can
 * carry an event id or a holder key (`family:<id>`), which no log line may hold.
 *
 * A demo school (`demo-<preset>`, `demo.ts`) ships nothing, so its views need no run every five minutes: each run
 * rebuilds at most one, the one whose views are oldest, and only once they are an hour old. Fifteen demo logs of a
 * year's days each would otherwise cost every run thousands of reads.
 */
import { readViewsFromStore, runViews } from "tfd/worker";
import { jobStatusKey, readJobProblem } from "./data/job-status.js";
import { putText, type Store } from "./data/store-io.js";
import { asOfFor } from "./data/watermark.js";
import { DEMO_SCHOOL } from "./demo.js";

const SCHOOLS_PREFIX = "schools/";
const TRAILING_SLASH = /\/$/;
const MS_PER_MINUTE = 60_000;
/** A demo school's views are rebuilt once they are this old. */
export const DEMO_REBUILD_MINUTES = 60;

export type ViewsJobResult =
	| { school: string; ok: true }
	| { school: string; ok: false; reason: string };

/** Every school id with a prefix under `schools/`, ascending. */
export const schoolIdsIn = async (store: Store): Promise<string[]> => {
	const ids: string[] = [];
	let cursor: string | undefined;
	for (;;) {
		const page = await store.list({
			prefix: SCHOOLS_PREFIX,
			delimiter: "/",
			cursor,
		});
		for (const prefix of page.prefixes)
			ids.push(prefix.slice(SCHOOLS_PREFIX.length).replace(TRAILING_SLASH, ""));
		if (page.next === null) break;
		cursor = page.next;
	}
	return ids.sort();
};

/** Records or clears the job note: only when the state changes, so a healthy school costs one read per run. */
const recordOutcome = async (
	store: Store,
	school: string,
	problem: { kind: string } | null,
	at: Date,
): Promise<void> => {
	const existing = await readJobProblem(store, school);
	if (problem === null && existing === null) return;
	if (problem !== null && existing?.kind === problem.kind) return;
	await putText(
		store,
		jobStatusKey(school),
		`${JSON.stringify(
			problem === null
				? { ok: true, at: at.toISOString() }
				: { ok: false, kind: problem.kind, at: at.toISOString() },
		)}\n`,
	);
};

const runOne = async (
	store: Store,
	school: string,
	asOf: Date,
): Promise<ViewsJobResult> => {
	try {
		const run = await runViews(
			store,
			school,
			await asOfFor(store, school, asOf),
		);
		if (!run.ok) {
			await recordOutcome(store, school, { kind: run.error.kind }, asOf);
			console.error(`views job failed for school ${school}`);
			return { school, ok: false, reason: run.error.kind };
		}
		await recordOutcome(store, school, null, asOf);
		return { school, ok: true };
	} catch {
		console.error(`views job failed for school ${school}`);
		return { school, ok: false, reason: "error" };
	}
};

/** The demo school whose views are oldest (none yet counts as oldest), when they are at least an hour old; else null. */
const demoSchoolDue = async (
	store: Store,
	schools: readonly string[],
	asOf: Date,
): Promise<string | null> => {
	let due: { school: string; at: number } | null = null;
	for (const school of schools) {
		const reader = await readViewsFromStore(store, school);
		const at = reader.ok
			? Date.parse(reader.manifest.asOf)
			: Number.NEGATIVE_INFINITY;
		if (due === null || at < due.at) due = { school, at };
	}
	return due !== null &&
		asOf.getTime() - due.at >= DEMO_REBUILD_MINUTES * MS_PER_MINUTE
		? due.school
		: null;
};

export const runViewsJob = async (
	store: Store,
	asOf: Date,
): Promise<ViewsJobResult[]> => {
	const results: ViewsJobResult[] = [];
	const schools = await schoolIdsIn(store);
	for (const school of schools.filter((id) => !DEMO_SCHOOL.test(id)))
		results.push(await runOne(store, school, asOf));
	const demo = await demoSchoolDue(
		store,
		schools.filter((id) => DEMO_SCHOOL.test(id)),
		asOf,
	);
	if (demo !== null) results.push(await runOne(store, demo, asOf));
	return results;
};
