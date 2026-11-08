import type { D1Database } from "./env";

/** Reads one JSON value saved in `schema_meta`, or null when none is saved yet. */
export const readMeta = async <T>(
	db: D1Database,
	key: string,
): Promise<T | null> => {
	const row = await db
		.prepare("SELECT value FROM schema_meta WHERE key = ?")
		.bind(key)
		.first<{ value: string }>();
	return row ? (JSON.parse(row.value) as T) : null;
};

/** Saves one JSON value in `schema_meta`, replacing any earlier one. */
export const writeMeta = async (
	db: D1Database,
	key: string,
	value: unknown,
): Promise<void> => {
	await db
		.prepare(
			"INSERT INTO schema_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
		)
		.bind(key, JSON.stringify(value))
		.run();
};
