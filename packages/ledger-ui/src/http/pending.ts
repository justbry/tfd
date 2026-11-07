import { canonicalJson, isRecord } from "./wire.ts";

/**
 * The writes the UI made that the ledger has not shipped yet (`S8-ui-needs.md`, "Rules the adapters must keep":
 * pending until the ledger ships, about 5 minutes, and still pending after a reload). Kept as JSON in an injected
 * `Storage`, so a reload reads the same list.
 *
 * One entry per user action. It is made before the request is sent (`sending`) and holds the action's
 * `Idempotency-Key`: the same action asked again (a retry after a network failure or a 503, before or after a reload)
 * finds the entry and sends the same key, so buzz-school answers the first result instead of acting twice. A refusal
 * drops it; an answer turns it `accepted`. An accepted write clears once a ledger Worker read's manifest `asOf` is at
 * or past its `shipsBy`. `shipsBy` is the `exp` of the ledger token in hand when the write was accepted: the family
 * service's clock, never earlier than the write (the token is refreshed before `exp`), so no clock is read here and
 * an entry is never cleared before its write could have shipped.
 */

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

export type PendingWrite = {
	/** The action's `Idempotency-Key`. */
	id: string;
	method: string;
	school: string;
	request: unknown;
	state: "sending" | "accepted";
	/** ISO instant; null while sending, or when no ledger token was in hand. */
	shipsBy: string | null;
};

export type PendingStore = {
	all(): PendingWrite[];
	forSchool(school: string): PendingWrite[];
	/** The entry of this action: the one still `sending` for the same method, school and request, else a new one. */
	begin(write: {
		method: string;
		school: string;
		request: unknown;
	}): PendingWrite;
	accept(id: string, shipsBy: string | null): void;
	drop(id: string): void;
	/** Drops the school's accepted writes that a read at `asOf` has shipped; answers how many. */
	clearShipped(school: string, asOf: string): number;
};

export const pendingStorageKey = "ledger-ui.pending.v1";

const isPendingWrite = (value: unknown): value is PendingWrite =>
	isRecord(value) &&
	typeof value.id === "string" &&
	typeof value.method === "string" &&
	typeof value.school === "string" &&
	(value.state === "sending" || value.state === "accepted") &&
	(value.shipsBy === null || typeof value.shipsBy === "string");

export function createPendingStore(options: {
	storage: StorageLike;
	newKey: () => string;
	storageKey?: string;
}): PendingStore {
	const storageKey = options.storageKey ?? pendingStorageKey;
	const read = (): PendingWrite[] => {
		const text = options.storage.getItem(storageKey);
		if (!text) return [];
		try {
			const parsed: unknown = JSON.parse(text);
			return Array.isArray(parsed) ? parsed.filter(isPendingWrite) : [];
		} catch {
			return [];
		}
	};
	const write = (entries: PendingWrite[]): void =>
		options.storage.setItem(storageKey, JSON.stringify(entries));

	return {
		all: read,
		forSchool: (school) => read().filter((entry) => entry.school === school),
		begin: ({ method, school, request }) => {
			const entries = read();
			const sameRequest = canonicalJson(request);
			const existing = entries.find(
				(entry) =>
					entry.state === "sending" &&
					entry.method === method &&
					entry.school === school &&
					canonicalJson(entry.request) === sameRequest,
			);
			if (existing) return existing;
			const entry: PendingWrite = {
				id: options.newKey(),
				method,
				school,
				request,
				state: "sending",
				shipsBy: null,
			};
			write([...entries, entry]);
			return entry;
		},
		accept: (id, shipsBy) =>
			write(
				read().map((entry) =>
					entry.id === id ? { ...entry, state: "accepted", shipsBy } : entry,
				),
			),
		drop: (id) => write(read().filter((entry) => entry.id !== id)),
		clearShipped: (school, asOf) => {
			const entries = read();
			const kept = entries.filter(
				(entry) =>
					!(
						entry.school === school &&
						entry.state === "accepted" &&
						entry.shipsBy !== null &&
						Date.parse(entry.shipsBy) <= Date.parse(asOf)
					),
			);
			if (kept.length !== entries.length) write(kept);
			return entries.length - kept.length;
		},
	};
}

/** A `Storage` that lives as long as the page: the tests', and the browser build's where the page may not persist. */
export function memoryStorage(): StorageLike & {
	snapshot(): Map<string, string>;
} {
	const items = new Map<string, string>();
	return {
		getItem: (key) => items.get(key) ?? null,
		setItem: (key, value) => {
			items.set(key, value);
		},
		snapshot: () => new Map(items),
	};
}
