import type { D1Database, R2Bucket } from "./env";

/** A page of 200 costs at most 601 subrequests (list, then head, get and put per object), so one page always fits. */
const PAGE_SIZE = 200;
/** Stays well inside a cron invocation's subrequest budget; a pass that needs more resumes on the next run. */
export const MAX_SUBREQUESTS_PER_RUN = 800;
const STATE_KEY = "backup_state";

/**
 * The backup copy of one version of a source object. The backup bucket's lock refuses overwrites, so each version has
 * its own key. An ETag is hex and holds no "/", so `versions/<etag>/<key>` can't collide for any source key.
 */
export const backupKey = (key: string, etag: string): string =>
	`versions/${etag}/${key}`;

/**
 * Where a pass is. `watermark`: every object uploaded before it is already copied. `cursor` and `passStartedAt`: a
 * pass in progress, resumed by the next run; when it completes, the watermark moves to when it started.
 */
export type BackupState = {
	watermark: string | null;
	cursor?: string;
	passStartedAt?: string;
};

export type BackupResult = {
	copied: number;
	skipped: number;
	failed: number;
	complete: boolean;
	state: BackupState;
};

export const readBackupState = async (db: D1Database): Promise<BackupState> => {
	const row = await db
		.prepare("SELECT value FROM schema_meta WHERE key = ?")
		.bind(STATE_KEY)
		.first<{ value: string }>();
	return row ? (JSON.parse(row.value) as BackupState) : { watermark: null };
};

export const writeBackupState = async (
	db: D1Database,
	state: BackupState,
): Promise<void> => {
	await db
		.prepare(
			"INSERT INTO schema_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
		)
		.bind(STATE_KEY, JSON.stringify(state))
		.run();
};

/**
 * One run of the nightly backup. Lists the source from the saved cursor, copies objects uploaded at or after the
 * watermark that the backup doesn't hold yet, and stops at the subrequest budget, saving the cursor. A failed object
 * is counted and logged, never fatal: the watermark only moves when a pass finishes with no failures, so the next pass
 * retries it.
 */
export const backupBucket = async ({
	source,
	backup,
	state,
	now,
	log = console,
}: {
	source: R2Bucket;
	backup: R2Bucket;
	state: BackupState;
	now: Date;
	log?: Pick<Console, "error">;
}): Promise<BackupResult> => {
	const passStartedAt = state.passStartedAt ?? now.toISOString();
	const since = state.watermark
		? new Date(state.watermark).getTime()
		: Number.NEGATIVE_INFINITY;
	let cursor = state.cursor;
	let subrequests = 0;
	const counts = { copied: 0, skipped: 0, failed: 0 };

	while (true) {
		if (subrequests + 1 > MAX_SUBREQUESTS_PER_RUN) {
			return {
				...counts,
				complete: false,
				state: { watermark: state.watermark, cursor, passStartedAt },
			};
		}
		const page = await source.list({ limit: PAGE_SIZE, cursor });
		subrequests += 1;
		const fresh = page.objects.filter(
			(object) => object.uploaded.getTime() >= since,
		);
		// Each fresh object costs up to three subrequests (head, get, put). Not enough budget left for this page: stop
		// before it and resume from the same cursor, so no object of the page is half-done.
		if (subrequests + fresh.length * 3 > MAX_SUBREQUESTS_PER_RUN) {
			return {
				...counts,
				complete: false,
				state: { watermark: state.watermark, cursor, passStartedAt },
			};
		}
		for (const object of fresh) {
			const target = backupKey(object.key, object.etag);
			try {
				subrequests += 1;
				if (await backup.head(target)) {
					counts.skipped += 1;
					continue;
				}
				subrequests += 2;
				const body = await source.get(object.key);
				if (!body) continue;
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

	const watermark = counts.failed === 0 ? passStartedAt : state.watermark;
	return { ...counts, complete: true, state: { watermark } };
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
): Promise<BackupResult> => {
	const result = await backupBucket({
		source,
		backup,
		state: await readBackupState(db),
		now,
		log,
	});
	await writeBackupState(db, result.state);
	const summary = `backup: ${result.copied} copied, ${result.skipped} already held, ${result.failed} failed, ${result.complete ? "pass complete" : "resuming next run"}`;
	if (result.failed > 0) log.error(summary);
	else log.log(summary);
	return result;
};
