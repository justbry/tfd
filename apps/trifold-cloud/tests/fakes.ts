import type { CloudEnv, D1Database, R2Bucket } from "../src/env";

type Stored = {
	bytes: string;
	etag: string;
	uploaded: Date;
	customMetadata?: Record<string, string>;
};

/** An in-memory bucket with R2's list/head/get/put shapes, paging by `limit` and a numeric cursor. */
export const memoryBucket = (
	initial: Record<string, string> = {},
	clock = () => new Date(),
) => {
	const objects = new Map<string, Stored>();
	let version = 0;
	const failingPuts = new Set<string>();
	const write = (
		key: string,
		bytes: string,
		customMetadata?: Record<string, string>,
	) => {
		version += 1;
		objects.set(key, {
			bytes,
			etag: `e${version}`,
			uploaded: clock(),
			customMetadata,
		});
	};
	for (const [key, bytes] of Object.entries(initial)) write(key, bytes);
	let calls = 0;
	const bucket: R2Bucket = {
		list: async ({ limit = 1000, cursor } = {}) => {
			calls += 1;
			const keys = [...objects.keys()].sort();
			const start = cursor ? Number(cursor) : 0;
			const truncated = start + limit < keys.length;
			return {
				objects: keys.slice(start, start + limit).map((key) => {
					const stored = objects.get(key) as Stored;
					return {
						key,
						etag: stored.etag,
						size: stored.bytes.length,
						uploaded: stored.uploaded,
					};
				}),
				truncated,
				cursor: truncated ? String(start + limit) : undefined,
			};
		},
		head: async (key) => {
			calls += 1;
			const stored = objects.get(key);
			return stored
				? {
						key,
						etag: stored.etag,
						size: stored.bytes.length,
						uploaded: stored.uploaded,
						customMetadata: stored.customMetadata,
					}
				: null;
		},
		get: async (key) => {
			calls += 1;
			const stored = objects.get(key);
			if (!stored) return null;
			return {
				key,
				etag: stored.etag,
				size: stored.bytes.length,
				uploaded: stored.uploaded,
				body: new Response(stored.bytes).body as ReadableStream,
			};
		},
		put: async (key, body, options) => {
			calls += 1;
			if (failingPuts.has(key)) throw new Error("put refused");
			if (objects.has(key)) throw new Error("locked: overwrite refused");
			write(key, await new Response(body).text(), options?.customMetadata);
		},
	};
	return { bucket, objects, write, failingPuts, calls: () => calls };
};

/** Just enough of D1 for `schema_meta` reads and upserts. */
export const memoryD1 = (fail = false) => {
	const meta = new Map<string, string>();
	const db: D1Database = {
		prepare: (query) => {
			let values: unknown[] = [];
			const statement = {
				bind: (...bound: unknown[]) => {
					values = bound;
					return statement;
				},
				first: async <T>() => {
					if (fail) throw new Error("D1 down");
					if (query.startsWith("SELECT value FROM schema_meta")) {
						const value = meta.get(values[0] as string);
						return (value === undefined ? null : { value }) as T | null;
					}
					return { one: 1 } as T;
				},
				run: async () => {
					meta.set(values[0] as string, values[1] as string);
					return {};
				},
			};
			return statement;
		},
	};
	return { db, meta };
};

export const fakeEnv = (
	overrides: { d1Fails?: boolean; booksFail?: boolean } = {},
): CloudEnv => {
	const books = memoryBucket().bucket;
	return {
		DB: memoryD1(overrides.d1Fails).db,
		BOOKS: overrides.booksFail
			? {
					...books,
					list: async () => {
						throw new Error("R2 down");
					},
				}
			: books,
		BACKUPS: memoryBucket().bucket,
		ORG: {
			idFromName: (name) => name,
			get: () => ({ fetch: async () => new Response("unused") }),
		},
		ENVIRONMENT: "staging",
		LEDGER_HOST: "staging-ledger.trifold.app",
		API_HOST: "staging-api.trifold.app",
	};
};
