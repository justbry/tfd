import type { R2Bucket } from "./env";

const PAGE_SIZE = 1000;

export type BackupResult = { copied: number; unchanged: number };

/**
 * The backup copy of one version of a source object. The backup bucket is under a bucket lock, which refuses
 * overwrites, so every version gets its own key: an object that changes in place (views, manifests) gains a new copy
 * and the old one stays until the lock's retention ends.
 */
export const backupKey = (key: string, etag: string): string =>
	`${key}@${etag}`;

/** Copies every object version of `source` the backup doesn't hold yet. A run with nothing new copies nothing. */
export const backupBucket = async (
	source: R2Bucket,
	backup: R2Bucket,
): Promise<BackupResult> => {
	const result: BackupResult = { copied: 0, unchanged: 0 };
	let cursor: string | undefined;
	do {
		const page = await source.list({ limit: PAGE_SIZE, cursor });
		for (const object of page.objects) {
			const target = backupKey(object.key, object.etag);
			if (await backup.head(target)) {
				result.unchanged += 1;
				continue;
			}
			const body = await source.get(object.key);
			if (!body) continue;
			await backup.put(target, body.body, {
				customMetadata: { sourceKey: object.key },
			});
			result.copied += 1;
		}
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	return result;
};
