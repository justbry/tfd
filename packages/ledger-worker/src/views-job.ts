/**
 * The cron job: for every school prefix in the bucket, `runViews` (read the log, build the views as of `asOf`, write them).
 * A school whose run fails does not stop the others. A failure is logged by school id only: the job's own messages can
 * carry an event id or a holder key (`family:<id>`), which no log line may hold.
 *
 * A demo school (`demo-<preset>`, `demo.ts`) ships nothing, so its views need no run every five minutes: each run
 * rebuilds at most one, the one whose views are oldest, and only once they are an hour old. Fifteen demo logs of a
 * year's days each would otherwise cost every run thousands of reads. The run also writes the demo school's route answers
 * again (`demo/demo-api-store.ts`), as of the same instant as its views.
 *
 * After a school's views, the run stores the generation's answers and log (`routes/stored.ts`, `data/answers.ts`) from
 * the events it has just read, for the local day of the run; a school whose views did not change costs one more read
 * (the pointer). A school whose answers cannot be stored is logged by id and still counts as done: its endpoints
 * compute. Last, the demo index (`data/demo-index.ts`) is written again when it changed.
 */
import {
	buildViews,
	readEventsFromStore,
	readViewsFromStore,
	writeViews,
} from "tfd/worker";
import { refreshDemoIndex } from "./data/demo-index.js";
import { jobStatusKey, readJobProblem } from "./data/job-status.js";
import { schoolIdsIn } from "./data/school-ids.js";
import { putText, type Store } from "./data/store-io.js";
import { asOfFor } from "./data/watermark.js";
import { writeDemoApi } from "./demo/demo-api-store.js";
import { DEMO_SCHOOL, readDemoFacts } from "./demo.js";
import { storeAnswers } from "./routes/stored.js";

export { schoolIdsIn } from "./data/school-ids.js";

const MS_PER_MINUTE = 60_000;
/** A demo school's views are rebuilt once they are this old. */
export const DEMO_REBUILD_MINUTES = 60;

export type ViewsJobResult =
	| { school: string; ok: true }
	| { school: string; ok: false; reason: string };

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
		const at = await asOfFor(store, school, asOf);
		// `runViews`, with the events kept for the answers below
		const events = await readEventsFromStore(store, school);
		const built = buildViews(events, { school, asOf: at });
		if (!built.ok) {
			await recordOutcome(store, school, { kind: built.error.kind }, asOf);
			console.error(`views job failed for school ${school}`);
			return { school, ok: false, reason: built.error.kind };
		}
		const written = await writeViews(store, school, built.views);
		// A demo school's route answers follow its views, as of the same instant.
		if (DEMO_SCHOOL.test(school))
			await writeDemoApi(
				store,
				school,
				events,
				await readDemoFacts(store, school),
				at,
			);
		try {
			// a run older than the stored views wrote nothing: its events are not the stored generation's
			await storeAnswers(
				store,
				school,
				asOf,
				written.stale ? undefined : events,
			);
		} catch {
			console.error(`stored answers failed for school ${school}`);
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
	if (schools.some((id) => DEMO_SCHOOL.test(id)))
		await refreshDemoIndex(store).catch(() => {
			console.error("demo index failed");
		});
	return results;
};
