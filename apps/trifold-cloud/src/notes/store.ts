import type { ChainLink, NoteDocumentBody, Role } from "tfd-notes";
import type { AgentRole } from "./org";

/**
 * What the guest flow keeps for one note (plans/promissory-notes/steps-2-5.md, W2a). Every method names its note, so
 * the Durable Object implementation can route each call to that note's own object, and every method is atomic: the
 * Durable Object runs one at a time inside a transaction, and the in-memory store has no await inside a method.
 *
 * Personal data lives in exactly one place, `Contacts`. An event, a chain link, an invite, a session, a counter and an
 * idempotency record never hold an email address (counters key on a hash of it).
 */

export interface Contacts {
	lender: string;
	borrower: string;
}

/**
 * One agent of the lender organization, as registered on this note. The email lives here and in no other place that
 * reaches a page or an event; events carry `agentRef` only. `role` is a copy of the role at registration: what an agent
 * may do is read from the org index (`OrgStore`), so a role change takes effect on every note at once.
 */
export interface AgentRecord {
	agentRef: string;
	email: string;
	role: AgentRole;
	active: boolean;
	addedAt: string;
}

/** An emailed link: only the sha256 of its token is kept. Single use. */
export interface InviteRecord {
	hash: string;
	role: Role;
	expiresAt: string;
}

/** A signed-in guest: only the sha256 of the cookie value is kept. */
export interface SessionRecord {
	hash: string;
	role: Role;
	createdAt: string;
	lastSeenAt: string;
	/** The session ends here whatever its activity. */
	absoluteExpiresAt: string;
}

/** A step-up code: only its hash is kept, bound to one session and one kind of action. */
export interface CodeRecord {
	codeHash: string;
	action: string;
	expiresAt: string;
}

/**
 * One signed document, kept as the exact JSON text that was issued so it can be served again byte for byte. `eventId`
 * is the event the document is about (the payment of a receipt, the `payoff.issued` or `release.confirmed` event), or
 * null; one document exists per `(type, eventId)` when `eventId` is set.
 */
export interface StoredDocument {
	id: string;
	type: NoteDocumentBody["type"];
	eventId: string | null;
	/** sha256 hex of the body's canonical JSON (`documentSha256`). */
	sha256: string;
	json: string;
	createdAt: string;
}

/** The latest chain-head seal of a note: the signed `note.chain-seal` JSON and the head it names. */
export interface StoredSeal {
	headSeq: number;
	sealedAt: string;
	json: string;
}

/**
 * What the store keeps for one grant (build step 5). The event holds only the opaque `audienceRef`; the recipient's
 * address lives here and nowhere else, and reaches a page only masked. Only the sha256 of a link token is kept.
 */
export interface ShareRecord {
	grantId: string;
	kind: "person" | "link";
	/** The `audience.ref` written to the event. Opaque, server-made, never an address. */
	audienceRef: string;
	/** A person share's address, normalized. Null for a verify link. */
	recipientEmail: string | null;
	/** sha256 of the current link token, or null while none has been issued. */
	linkHash: string | null;
	/** When a person share's emailed link was redeemed; null while unused. A verify link is never "used up". */
	linkUsedAt: string | null;
	createdAt: string;
}

/** A share viewer's session: only the sha256 of the cookie value is kept. It belongs to one grant. */
export interface ShareSessionRecord {
	hash: string;
	grantId: string;
	createdAt: string;
	/** The session ends here whatever its activity (never past the grant's own end). */
	absoluteExpiresAt: string;
}

export type AppendResult =
	| { ok: true }
	| { ok: false; reason: "conflict"; seq: number };

/** What a request to try a code finds. `ok` counts as one of the allowed attempts; the caller compares the hash. */
export type AttemptResult =
	| { status: "ok"; codeHash: string; action: string }
	| { status: "none" | "expired" | "locked" };

export type IdempotencyResult = "new" | "same" | "different";

export interface NoteStore {
	/** Event JSON texts in `seq` order, and their chain links. */
	readLog(noteId: string): Promise<{ events: string[]; links: ChainLink[] }>;
	/**
	 * Adds one event and its link when the log still ends at `expectedSeq` (0 for an empty log); `entry.link.seq` must
	 * be `expectedSeq + 1`. Otherwise nothing is written and the answer is a conflict carrying the log's current seq.
	 * A `document` is written in the same atomic step, so an event that names a document (`payoff.issued`) never exists
	 * without it.
	 */
	append(
		noteId: string,
		expectedSeq: number,
		entry: { eventJson: string; link: ChainLink; document?: StoredDocument },
	): Promise<AppendResult>;
	/**
	 * Stores `document`, unless one with the same `(type, eventId)` exists (only when `eventId` is not null): then
	 * nothing is written and the existing one is returned. So the first issued receipt of a payment is the only one.
	 */
	putDocumentOnce(
		noteId: string,
		document: StoredDocument,
	): Promise<StoredDocument>;
	/** The document with this id in this note, or null (a document of another note is never found here). */
	getDocument(noteId: string, docId: string): Promise<StoredDocument | null>;
	/** Every document of the note in the order they were stored. */
	listDocuments(noteId: string): Promise<StoredDocument[]>;
	/** Keeps `seal` when its head is at or past the stored one; an older seal never replaces a newer one. */
	putSeal(noteId: string, seal: StoredSeal): Promise<void>;
	getSeal(noteId: string): Promise<StoredSeal | null>;
	/** Writes the two addresses once; a second call for the same note changes nothing. */
	putContacts(noteId: string, contacts: Contacts): Promise<void>;
	getContacts(noteId: string): Promise<Contacts | null>;
	/** Marks the note's lender as an organization; written once, a second call changes nothing. */
	putOrg(noteId: string, orgId: string): Promise<void>;
	/** The organization that is this note's lender, or null for a person lender. */
	getOrg(noteId: string): Promise<string | null>;
	/** Adds an agent, or updates the email, role and active flag of the agent with this ref. */
	putAgent(noteId: string, agent: AgentRecord): Promise<void>;
	getAgent(noteId: string, agentRef: string): Promise<AgentRecord | null>;
	/** Every agent of the note in the order they were added. */
	listAgents(noteId: string): Promise<AgentRecord[]>;
	/** True when the note has this agent (and now has the flag asked for). */
	setAgentActive(
		noteId: string,
		agentRef: string,
		active: boolean,
	): Promise<boolean>;
	putInvite(noteId: string, invite: InviteRecord): Promise<void>;
	/** Marks the invite used and returns its role, or null when it is unknown, used or past `expiresAt`. */
	redeemInvite(noteId: string, hash: string, now: string): Promise<Role | null>;
	putSession(noteId: string, session: SessionRecord): Promise<void>;
	/**
	 * The session, with its last-seen moved to `now`, or null when it is unknown, idle for more than `idleMs` or past
	 * its absolute end (an ended session is deleted).
	 */
	touchSession(
		noteId: string,
		hash: string,
		now: string,
		idleMs: number,
	): Promise<SessionRecord | null>;
	deleteSession(noteId: string, hash: string): Promise<void>;
	/** Replaces the session's code and resets its attempts. */
	putCode(noteId: string, sessionHash: string, code: CodeRecord): Promise<void>;
	takeAttempt(
		noteId: string,
		sessionHash: string,
		now: string,
		maxAttempts: number,
	): Promise<AttemptResult>;
	/** Deletes the session's code; true only for the caller that deleted it, so a code is used once. */
	clearCode(noteId: string, sessionHash: string): Promise<boolean>;
	/** Counts one hit in a fixed window; true while the count stays within `limit`. */
	hit(
		noteId: string,
		key: string,
		now: string,
		windowMs: number,
		limit: number,
	): Promise<boolean>;
	/** Keeps the share once per grant id; a second call for the same grant changes nothing. */
	putShare(noteId: string, share: ShareRecord): Promise<void>;
	getShare(noteId: string, grantId: string): Promise<ShareRecord | null>;
	/** Every share of the note in the order they were created. */
	listShares(noteId: string): Promise<ShareRecord[]>;
	/**
	 * Sets the grant's link hash. Without `replace` it writes only when no hash is set; with `replace` it overwrites the
	 * hash and marks the link unused. True when a hash was written.
	 */
	issueShareLink(
		noteId: string,
		grantId: string,
		hash: string,
		replace: boolean,
	): Promise<boolean>;
	/** Marks a person share's link used when `hash` is the stored one and it was not used yet; true for that one caller. */
	claimShareLink(
		noteId: string,
		grantId: string,
		hash: string,
		now: string,
	): Promise<boolean>;
	putShareSession(noteId: string, session: ShareSessionRecord): Promise<void>;
	/** The share session, or null when it is unknown or past its end (an ended session is deleted). */
	getShareSession(
		noteId: string,
		hash: string,
		now: string,
	): Promise<ShareSessionRecord | null>;
	/**
	 * Records `(caller, key)` with the request's fingerprint the first time: `new`. The same fingerprint again is
	 * `same`; a different one is `different` (the key was reused for another request).
	 */
	claimIdempotency(
		noteId: string,
		caller: string,
		key: string,
		fingerprint: string,
	): Promise<IdempotencyResult>;
}
