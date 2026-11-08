import { backupKey } from "./backup";
import type { D1Database, R2Bucket } from "./env";

const STATE_KEY = "prune_state";
const MAX_PAGE_SIZE = 200;
/** Worst case per old copy: source head, D1 read, backup head of the current copy, delete, D1 delete. */
const COST_PER_COPY = 5;
const DAY_MS = 86_400_000;
/** Matches the bucket lock. A copy is deleted only after it has been superseded this long. */
export const RETENTION_DAYS = 30;
const VERSIONED = /^versions\/([^/]+)\/(.+)$/;

export type PruneState = { cursor?: string };
export type PruneResult = {
	deleted: number;
	kept: number;
	failed: number;
	complete: boolean;
	state: PruneState;
};

export const readPruneState = async (db: D1Database): Promise<PruneState> => {
	const row = await db
		.prepare("SELECT value FROM schema_meta WHERE key = ?")
		.bind(STATE_KEY)
		.first<{ value: string }>();
	return row ? (JSON.parse(row.value) as PruneState) : {};
};

export const writePruneState = async (
	db: D1Database,
	state: PruneState,
): Promise<void> => {
	await db
		.prepare(
			"INSERT INTO schema_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
		)
		.bind(STATE_KEY, JSON.stringify(state))
		.run();
};

const supersededSince = async (
	db: D1Database,
	copyKey: string,
): Promise<string | null> =>
	(
		await db
			.prepare("SELECT first_seen FROM backup_superseded WHERE copy_key = ?")
			.bind(copyKey)
			.first<{ first_seen: string }>()
	)?.first_seen ?? null;

/**
 * Deletes backup copies that have been superseded for longer than the retention: their source was rewritten or deleted
 * at least 30 days ago, as first seen by this pass and recorded in `backup_superseded`. A rewritten object's old copy
 * goes only once the backup holds its current version. The current version of every object is never deleted, however
 * old, and an accidental delete or bad write at the source leaves the last good copy for 30 days. Resumes from a saved
 * cursor within the budget.
 */
export const pruneSuperseded = async ({
	db,
	source,
	backup,
	state,
	now,
	budget,
	log = console,
}: {
	db: D1Database;
	source: R2Bucket;
	backup: R2Bucket;
	state: PruneState;
	now: Date;
	budget: number;
	log?: Pick<Console, "error">;
}): Promise<PruneResult> => {
	const cutoff = now.getTime() - RETENTION_DAYS * DAY_MS;
	const counts = { deleted: 0, kept: 0, failed: 0 };
	const pageSize = Math.min(
		MAX_PAGE_SIZE,
		Math.floor((budget - 1) / COST_PER_COPY),
	);
	if (pageSize < 1) return { ...counts, complete: false, state };
	let cursor = state.cursor;
	let subrequests = 0;

	while (true) {
		if (subrequests + 1 + pageSize * COST_PER_COPY > budget) {
			return { ...counts, complete: false, state: { cursor } };
		}
		const page = await backup.list({ limit: pageSize, cursor });
		subrequests += 1;
		for (const copy of page.objects) {
			const match = VERSIONED.exec(copy.key);
			// A copy younger than the retention can't have been superseded that long (and the lock keeps it anyway).
			if (!match || copy.uploaded.getTime() > cutoff) {
				counts.kept += 1;
				continue;
			}
			const [, etag, sourceKey] = match as unknown as [string, string, string];
			try {
				subrequests += 1;
				const current = await source.head(sourceKey);
				if (current?.etag === etag) {
					// Current again (never superseded, or restored from this copy with its original bytes): forget any
					// earlier supersession, so a later mistake gets its full 30 days.
					subrequests += 1;
					await db
						.prepare("DELETE FROM backup_superseded WHERE copy_key = ?")
						.bind(copy.key)
						.run();
					counts.kept += 1;
					continue;
				}
				subrequests += 1;
				const firstSeen = await supersededSince(db, copy.key);
				if (firstSeen === null) {
					subrequests += 1;
					await db
						.prepare(
							"INSERT INTO backup_superseded (copy_key, first_seen) VALUES (?, ?)",
						)
						.bind(copy.key, now.toISOString())
						.run();
					counts.kept += 1;
					continue;
				}
				if (new Date(firstSeen).getTime() > cutoff) {
					counts.kept += 1;
					continue;
				}
				if (current) {
					// Rewritten: keep the old copy until the current version is safely in the backup.
					subrequests += 1;
					if (!(await backup.head(backupKey(sourceKey, current.etag)))) {
						counts.kept += 1;
						continue;
					}
				}
				subrequests += 2;
				await backup.delete(copy.key);
				await db
					.prepare("DELETE FROM backup_superseded WHERE copy_key = ?")
					.bind(copy.key)
					.run();
				counts.deleted += 1;
			} catch (error) {
				counts.failed += 1;
				log.error(
					`prune failed for a copy: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
		if (!page.truncated) return { ...counts, complete: true, state: {} };
		cursor = page.cursor;
	}
};
