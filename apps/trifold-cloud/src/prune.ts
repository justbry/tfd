import type { D1Database, R2Bucket } from "./env";

const STATE_KEY = "prune_state";
const PAGE_SIZE = 200;
const DAY_MS = 86_400_000;
/** Matches the bucket lock: a copy can't be deleted sooner, and a superseded version is kept this long. */
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

/**
 * Deletes backup copies that are older than the retention and no longer the source's current version (rewritten or
 * deleted at the source). The current version of every object is never deleted, however old, so an object that never
 * changes stays backed up forever. Resumes from a saved cursor within the budget; each old copy costs a source head and
 * maybe a delete.
 */
export const pruneSuperseded = async ({
	source,
	backup,
	state,
	now,
	budget,
	log = console,
}: {
	source: R2Bucket;
	backup: R2Bucket;
	state: PruneState;
	now: Date;
	budget: number;
	log?: Pick<Console, "error">;
}): Promise<PruneResult> => {
	const cutoff = now.getTime() - RETENTION_DAYS * DAY_MS;
	const counts = { deleted: 0, kept: 0, failed: 0 };
	let cursor = state.cursor;
	let subrequests = 0;
	const pageSize = Math.min(PAGE_SIZE, Math.floor((budget - 1) / 2));
	if (pageSize < 1) return { ...counts, complete: false, state };

	while (true) {
		if (subrequests + 1 + pageSize * 2 > budget)
			return { ...counts, complete: false, state: { cursor } };
		const page = await backup.list({ limit: pageSize, cursor });
		subrequests += 1;
		for (const copy of page.objects) {
			const match = VERSIONED.exec(copy.key);
			if (!match || copy.uploaded.getTime() > cutoff) {
				counts.kept += 1;
				continue;
			}
			const [, etag, sourceKey] = match as unknown as [string, string, string];
			try {
				subrequests += 1;
				const current = await source.head(sourceKey);
				if (current?.etag === etag) {
					counts.kept += 1;
					continue;
				}
				subrequests += 1;
				await backup.delete(copy.key);
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
