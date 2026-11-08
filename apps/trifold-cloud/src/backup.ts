import type { D1Database, R2Bucket } from "./env";
import { readMeta, writeMeta } from "./meta";

/** Each fresh object costs up to three subrequests (head, get, put) after the page's list call. */
const MAX_PAGE_SIZE = 200;
/** The smallest budget that can copy one object: a list, then head, get and put. */
export const MIN_SUBREQUEST_BUDGET = 4;
/** A page that always fits a fresh run's budget, so a pass can't stall on a page of new objects. */
export const pageSizeFor = (budget: number): number =>
	Math.min(MAX_PAGE_SIZE, Math.floor((budget - 1) / 3));
/** The default budget of one run; the cron runs hourly, so a pass that needs more resumes within the hour. */
export const DEFAULT_SUBREQUEST_BUDGET = 900;
const STATE_KEY = "backup_state";
/**
 * The watermark is this Worker's clock but is compared with R2's `uploaded` times. Re-check a margin before it, so a
 * write just after a pass starts that R2 stamps slightly earlier isn't missed; a copy already held costs only a head.
 */
const CLOCK_SKEW_MS = 5 * 60_000;

/**
 * The backup copy of one version of a source object. The backup bucket's lock refuses overwrites, so each version has
 * its own key. An ETag is hex and holds no "/", so `versions/<etag>/<key>` can't collide for any source key.
 */
export const backupKey = (key: string, etag: string): string =>
	`versions/${etag}/${key}`;

/**
 * Where a pass is. `watermark`: every object uploaded before it is already copied. `cursor` and `passStartedAt`: a
 * pass in progress, resumed by the next run; when it completes, the watermark moves to when it started. `passFailed`:
 * an earlier run of this pass had a failure, so the pass must not move the watermark even if its last run is clean.
 */
export type BackupState = {
	watermark: string | null;
	cursor?: string;
	passStartedAt?: string;
	passFailed?: boolean;
};

export type BackupResult = {
	copied: number;
	skipped: number;
	failed: number;
	complete: boolean;
	/** Subrequests this run used, so the cron can give the rest to the prune pass. */
	used: number;
	state: BackupState;
};

export const readBackupState = async (db: D1Database): Promise<BackupState> =>
	(await readMeta<BackupState>(db, STATE_KEY)) ?? { watermark: null };

export const writeBackupState = (
	db: D1Database,
	state: BackupState,
): Promise<void> => writeMeta(db, STATE_KEY, state);

/**
 * One run of the hourly backup. Lists the source from the saved cursor, copies objects uploaded at or after the
 * watermark that the backup doesn't hold yet, and stops at the subrequest budget, saving the cursor. A failed object
 * is counted and logged, never fatal: the watermark only moves when a pass finishes with no failures, so the next pass
 * retries it.
 */
export const backupBucket = async ({
	source,
	backup,
	state,
	now,
	budget = DEFAULT_SUBREQUEST_BUDGET,
	log = console,
}: {
	source: R2Bucket;
	backup: R2Bucket;
	state: BackupState;
	now: Date;
	budget?: number;
	log?: Pick<Console, "error">;
}): Promise<BackupResult> => {
	if (budget < MIN_SUBREQUEST_BUDGET)
		throw new Error(`backup budget must be at least ${MIN_SUBREQUEST_BUDGET}`);
	const passStartedAt = state.passStartedAt ?? now.toISOString();
	const since = state.watermark
		? new Date(state.watermark).getTime() - CLOCK_SKEW_MS
		: Number.NEGATIVE_INFINITY;
	let cursor = state.cursor;
	let subrequests = 0;
	const counts = { copied: 0, skipped: 0, failed: 0 };
	const resume = (): BackupResult => ({
		...counts,
		complete: false,
		used: subrequests,
		state: {
			watermark: state.watermark,
			cursor,
			passStartedAt,
			...(state.passFailed || counts.failed > 0 ? { passFailed: true } : {}),
		},
	});

	while (true) {
		if (subrequests + 1 > budget) return resume();
		const page = await source.list({ limit: pageSizeFor(budget), cursor });
		subrequests += 1;
		const fresh = page.objects.filter(
			(object) => object.uploaded.getTime() >= since,
		);
		// Each fresh object costs up to three subrequests (head, get, put). Not enough budget left for this page: stop
		// before it and resume from the same cursor, so no object of the page is half-done.
		if (subrequests + fresh.length * 3 > budget) return resume();
		for (const object of fresh) {
			const target = backupKey(object.key, object.etag);
			try {
				subrequests += 1;
				if (await backup.head(target)) {
					counts.skipped += 1;
					continue;
				}
				subrequests += 2;
				// Only the version the listing named: an object rewritten since the list would otherwise land under the old
				// ETag, where the lock would then refuse the correction. A miss counts as a failure, so the watermark stays
				// and the next pass copies whatever version is current.
				const body = await source.get(object.key, {
					onlyIf: { etagMatches: object.etag },
				});
				if (!(body && "body" in body)) {
					counts.failed += 1;
					log.error(
						"backup skipped an object that changed or vanished since the listing",
					);
					continue;
				}
				await backup.put(target, body.body, {
					customMetadata: { sourceKey: object.key },
				});
				counts.copied += 1;
			} catch (error) {
				counts.failed += 1;
				log.error(
					`backup failed for an object: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
		if (!page.truncated) break;
		cursor = page.cursor;
	}

	const passClean = counts.failed === 0 && !state.passFailed;
	const watermark = passClean ? passStartedAt : state.watermark;
	return { ...counts, complete: true, used: subrequests, state: { watermark } };
};

/** The cron entry: one run, state saved in D1, a summary logged, and any failure logged as an error. */
export const runBackup = async (
	{
		db,
		source,
		backup,
	}: { db: D1Database; source: R2Bucket; backup: R2Bucket },
	now: Date,
	log: Pick<Console, "log" | "error"> = console,
	budget = DEFAULT_SUBREQUEST_BUDGET,
): Promise<BackupResult> => {
	const result = await backupBucket({
		source,
		backup,
		state: await readBackupState(db),
		now,
		budget,
		log,
	});
	await writeBackupState(db, result.state);
	const summary = `backup: ${result.copied} copied, ${result.skipped} already held, ${result.failed} failed, ${result.complete ? "pass complete" : "resuming next run"}`;
	if (result.failed > 0) log.error(summary);
	else log.log(summary);
	return result;
};
