/**
 * Storage ports. Each consumer brings its own adapter (R2 via `objectStore…`, SQLite in a Durable Object, …) and
 * proves it with the contract suites in `tfd-credentials/testing`.
 */
import type {
	BitstringStatusListCredential,
	OpenBadgeCredential,
} from "./types.js";

/** What a status list store keeps per list. */
export type StatusListRecord = {
	/** The signed list credential, exactly as published. */
	credential: BitstringStatusListCredential;
	/** The indexes handed out, as an encoded bitstring like `encodedList`. Private: never published. */
	allocations: string;
};

export type Versioned<T> = { value: T; etag: string };

/** A conditional write either lands (with the new ETag) or finds the precondition false. */
export type WriteOutcome =
	| { status: "written"; etag: string }
	| { status: "conflict" };

/**
 * Status lists by list credential URL. `putIfMatch` is the only way to change a list, so two writers flipping bits at
 * once cannot clobber each other: the loser sees `conflict`, re-reads and re-applies.
 */
export interface StatusListStore {
	get(id: string): Promise<Versioned<StatusListRecord> | null>;
	/** `conflict` when the id exists. */
	putIfAbsent(id: string, record: StatusListRecord): Promise<WriteOutcome>;
	/** `conflict` when the stored ETag is not `etag`, or the id does not exist. */
	putIfMatch(
		id: string,
		record: StatusListRecord,
		etag: string,
	): Promise<WriteOutcome>;
}

/** A stored credential and the two index fields `list` filters on. Status lives in the status lists, not here. */
export type StoredCredential = {
	credential: OpenBadgeCredential;
	/** The caller's opaque holder key (e.g. a member id), kept beside the credential, never inside it. */
	holder: string | null;
	level: string | null;
};

export type CredentialFilter = { holder?: string; level?: string };

/** `existing`: the same credential was already there (a retry). `conflict`: another credential has the id. */
export type CredentialPutOutcome = "created" | "existing" | "conflict";

/** Issued credentials are immutable: `put` is create-only. */
export interface CredentialStore {
	put(entry: StoredCredential): Promise<CredentialPutOutcome>;
	get(id: string): Promise<StoredCredential | null>;
	/** Every credential matching all given fields, in no particular order. */
	list(filter?: CredentialFilter): Promise<StoredCredential[]>;
}
