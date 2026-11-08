/**
 * In-memory stores: the reference implementation the contract suites are written against, and the store for tests.
 * Values are kept as canonical JSON text, so a caller mutating an object after `put` or `get` changes nothing stored.
 */
import { canonicalize } from "./canonical.js";
import type {
	CredentialFilter,
	CredentialPutOutcome,
	CredentialStore,
	StatusListRecord,
	StatusListStore,
	StoredCredential,
	Versioned,
	WriteOutcome,
} from "./ports.js";

export const matchesFilter = (
	entry: StoredCredential,
	filter: CredentialFilter,
): boolean =>
	(filter.holder === undefined || entry.holder === filter.holder) &&
	(filter.level === undefined || entry.level === filter.level);

export const memoryCredentialStore = (): CredentialStore => {
	const entries = new Map<string, string>();
	return {
		put: async (entry): Promise<CredentialPutOutcome> => {
			const text = canonicalize(entry);
			const existing = entries.get(entry.credential.id);
			if (existing === undefined) {
				entries.set(entry.credential.id, text);
				return "created";
			}
			return existing === text ? "existing" : "conflict";
		},
		get: async (id) => {
			const text = entries.get(id);
			return text === undefined ? null : (JSON.parse(text) as StoredCredential);
		},
		list: async (filter = {}) => {
			const out: StoredCredential[] = [];
			for (const text of entries.values()) {
				const entry = JSON.parse(text) as StoredCredential;
				if (matchesFilter(entry, filter)) out.push(entry);
			}
			return out;
		},
	};
};

export const memoryStatusListStore = (): StatusListStore => {
	const records = new Map<string, { text: string; etag: string }>();
	let revision = 0;
	const write = (id: string, record: StatusListRecord): WriteOutcome => {
		revision++;
		const etag = `"r${revision}"`;
		records.set(id, { text: canonicalize(record), etag });
		return { status: "written", etag };
	};
	return {
		get: async (id): Promise<Versioned<StatusListRecord> | null> => {
			const stored = records.get(id);
			if (stored === undefined) return null;
			return {
				value: JSON.parse(stored.text) as StatusListRecord,
				etag: stored.etag,
			};
		},
		putIfAbsent: async (id, record) =>
			records.has(id) ? { status: "conflict" } : write(id, record),
		putIfMatch: async (id, record, etag) =>
			records.get(id)?.etag === etag
				? write(id, record)
				: { status: "conflict" },
	};
};
