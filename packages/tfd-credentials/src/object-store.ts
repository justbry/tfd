/**
 * Adapters from a minimal object store to the two ports. `ObjectStore` is a structural subset of atm's `Store`
 * (packages/atm/src/store/store.ts), so atm's R2Store and FolderStore plug in as they are, with no import of atm.
 * Errors are recognised by `name`, as atm's store errors set it explicitly: `NotFound`, `AlreadyExists`, `Stale`.
 *
 * Bodies are canonical JSON (RFC 8785), so equal records are equal bytes and atm's sha256 content identity holds.
 * Keys are the SHA-256 hex of the id: fixed length, lower case (safe on case-folding filesystems), no URL syntax.
 */
import { sha256Bytes, toHex, utf8 } from "./bytes.js";
import { canonicalize } from "./canonical.js";
import { matchesFilter } from "./memory-store.js";
import type {
	CredentialPutOutcome,
	CredentialStore,
	StatusListRecord,
	StatusListStore,
	StoredCredential,
	WriteOutcome,
} from "./ports.js";

export interface ObjectStore {
	/** Throws an error named `NotFound` when the key does not exist. */
	get(key: string): Promise<{ body: Uint8Array; etag: string }>;
	/** Create-only. Throws an error named `AlreadyExists` when the key exists. */
	putIfAbsent(key: string, body: Uint8Array): Promise<{ etag: string }>;
	/** Throws an error named `Stale` (or `NotFound`) when the object no longer has `etag`. */
	putIfMatch(
		key: string,
		body: Uint8Array,
		etag: string,
	): Promise<{ etag: string }>;
	list(options?: {
		prefix?: string;
		cursor?: string;
	}): Promise<{ objects: { key: string }[]; next: string | null }>;
}

export type ObjectStoreLayout = {
	/** Every key starts with this, e.g. `orgs/<org>/`. Default "". */
	prefix?: string;
};

const errorNamed = (error: unknown, ...names: string[]): boolean =>
	error instanceof Error && names.includes(error.name);

const decoder = new TextDecoder();

const keyOf = (prefix: string, kind: string, id: string): string =>
	`${prefix}${kind}/${toHex(sha256Bytes(utf8(id)))}.json`;

const readJson = async <T>(
	store: ObjectStore,
	key: string,
): Promise<{ value: T; etag: string; text: string } | null> => {
	try {
		const object = await store.get(key);
		const text = decoder.decode(object.body);
		return { value: JSON.parse(text) as T, etag: object.etag, text };
	} catch (error) {
		if (errorNamed(error, "NotFound")) return null;
		throw error;
	}
};

export const objectStoreCredentialStore = (
	store: ObjectStore,
	layout: ObjectStoreLayout = {},
): CredentialStore => {
	const prefix = layout.prefix ?? "";
	const folder = `${prefix}credential/`;
	return {
		put: async (entry: StoredCredential): Promise<CredentialPutOutcome> => {
			const text = canonicalize(entry);
			const key = keyOf(prefix, "credential", entry.credential.id);
			try {
				await store.putIfAbsent(key, utf8(text));
				return "created";
			} catch (error) {
				if (!errorNamed(error, "AlreadyExists")) throw error;
				const existing = await readJson<StoredCredential>(store, key);
				return existing !== null && canonicalize(existing.value) === text
					? "existing"
					: "conflict";
			}
		},
		get: async (id) => {
			const found = await readJson<StoredCredential>(
				store,
				keyOf(prefix, "credential", id),
			);
			return found === null ? null : found.value;
		},
		// A full scan: an object store has no secondary index. A store with one (SQLite) should use it instead.
		list: async (filter = {}) => {
			const out: StoredCredential[] = [];
			let cursor: string | undefined;
			for (;;) {
				const page = await store.list(
					cursor === undefined
						? { prefix: folder }
						: { prefix: folder, cursor },
				);
				for (const object of page.objects) {
					const found = await readJson<StoredCredential>(store, object.key);
					if (found !== null && matchesFilter(found.value, filter))
						out.push(found.value);
				}
				if (page.next === null) return out;
				cursor = page.next;
			}
		},
	};
};

export const objectStoreStatusListStore = (
	store: ObjectStore,
	layout: ObjectStoreLayout = {},
): StatusListStore => {
	const prefix = layout.prefix ?? "";
	return {
		get: async (id) => {
			const found = await readJson<StatusListRecord>(
				store,
				keyOf(prefix, "status-list", id),
			);
			return found === null ? null : { value: found.value, etag: found.etag };
		},
		putIfAbsent: async (id, record): Promise<WriteOutcome> => {
			try {
				const { etag } = await store.putIfAbsent(
					keyOf(prefix, "status-list", id),
					utf8(canonicalize(record)),
				);
				return { status: "written", etag };
			} catch (error) {
				if (errorNamed(error, "AlreadyExists")) return { status: "conflict" };
				throw error;
			}
		},
		putIfMatch: async (id, record, etag): Promise<WriteOutcome> => {
			const key = keyOf(prefix, "status-list", id);
			const text = canonicalize(record);
			try {
				const written = await store.putIfMatch(key, utf8(text), etag);
				return { status: "written", etag: written.etag };
			} catch (error) {
				if (!errorNamed(error, "Stale", "NotFound")) throw error;
				// A retried write whose first try landed reads back as these exact bytes: that is success, not a race
				// (the same rule as atm's replaceIfMatch).
				const current = await readJson<StatusListRecord>(store, key);
				if (current !== null && current.text === text)
					return { status: "written", etag: current.etag };
				return { status: "conflict" };
			}
		},
	};
};
