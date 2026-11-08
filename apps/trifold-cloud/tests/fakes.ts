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
	let streamedPuts = 0;
	const bucket: R2Bucket = {
		list: async ({ limit = 1000, cursor } = {}) => {
			calls += 1;
			// Like R2, the cursor marks a position in key order (the last key returned), so deletes behind it don't shift
			// the next page.
			const keys = [...objects.keys()]
				.sort()
				.filter((key) => cursor === undefined || key > cursor);
			const page = keys.slice(0, limit);
			const truncated = keys.length > limit;
			return {
				objects: page.map((key) => {
					const stored = objects.get(key) as Stored;
					return {
						key,
						etag: stored.etag,
						size: stored.bytes.length,
						uploaded: stored.uploaded,
					};
				}),
				truncated,
				cursor: truncated ? page.at(-1) : undefined,
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
		get: async (key, options) => {
			calls += 1;
			const stored = objects.get(key);
			if (!stored) return null;
			const meta = {
				key,
				etag: stored.etag,
				size: stored.bytes.length,
				uploaded: stored.uploaded,
			};
			const wanted = options?.onlyIf?.etagMatches;
			// R2 answers a failed precondition with the object's metadata and no body.
			if (wanted !== undefined && wanted !== stored.etag) return meta;
			return {
				...meta,
				body: new Response(stored.bytes).body as ReadableStream,
			};
		},
		delete: async (key) => {
			calls += 1;
			objects.delete(key);
		},
		put: async (key, body, options) => {
			calls += 1;
			if (!(body instanceof ReadableStream))
				throw new Error("put expects a stream");
			streamedPuts += 1;
			if (failingPuts.has(key)) throw new Error("put refused");
			if (objects.has(key)) throw new Error("locked: overwrite refused");
			write(key, await new Response(body).text(), options?.customMetadata);
		},
	};
	return {
		bucket,
		objects,
		write,
		failingPuts,
		calls: () => calls,
		streamedPuts: () => streamedPuts,
	};
};

/** Just enough of D1 for `schema_meta` reads and upserts. */
export const memoryD1 = (fail = false) => {
	const meta = new Map<string, string>();
	const superseded = new Map<string, string>();
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
					if (query.startsWith("SELECT first_seen FROM backup_superseded")) {
						const firstSeen = superseded.get(values[0] as string);
						return (
							firstSeen === undefined ? null : { first_seen: firstSeen }
						) as T | null;
					}
					if (query.startsWith("SELECT value FROM schema_meta")) {
						const value = meta.get(values[0] as string);
						return (value === undefined ? null : { value }) as T | null;
					}
					return { one: 1 } as T;
				},
				run: async () => {
					if (query.startsWith("INSERT INTO backup_superseded")) {
						superseded.set(values[0] as string, values[1] as string);
						return {};
					}
					if (query.startsWith("DELETE FROM backup_superseded")) {
						superseded.delete(values[0] as string);
						return {};
					}
					meta.set(values[0] as string, values[1] as string);
					return {};
				},
			};
			return statement;
		},
	};
	return { db, meta, superseded };
};

/** A fresh Ed25519 private key as PKCS8 PEM, as Secrets Store would hand it over. */
export const signingPem = async (): Promise<string> => {
	const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
		"sign",
		"verify",
	])) as CryptoKeyPair;
	const der = new Uint8Array(
		await crypto.subtle.exportKey("pkcs8", pair.privateKey),
	);
	const base64 = btoa(String.fromCharCode(...der));
	return `-----BEGIN PRIVATE KEY-----\n${base64}\n-----END PRIVATE KEY-----\n`;
};

const secret = (value: string) => ({ get: async () => value });

export const fakeEnv = (
	overrides: {
		d1Fails?: boolean;
		booksFail?: boolean;
		badSigningKey?: boolean;
	} = {},
	pem = "",
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
		SIGNING_RECEIPT: secret(overrides.badSigningKey ? "not a key" : pem),
		SIGNING_SEAL: secret(pem),
		SIGNING_DIRECTORY: secret(pem),
		ENVIRONMENT: "staging",
		LEDGER_HOST: "staging-ledger.trifold.app",
		API_HOST: "staging-api.trifold.app",
	};
};
