import type { Role } from "tfd-notes";
import type { AgentRole } from "./org";

/**
 * What the organization side keeps across notes (build step 4): the index of an organization's notes, its agents, and
 * their links, sessions and counters. It lives in D1 in the Worker (`org-d1-store.ts`, migration 0003) and in memory
 * in tests. It never holds an email address: an agent is matched by a salted hash (`emailHash`), used only to find the
 * agent a link request names. The addresses themselves live in each note's own store (`NoteStore`).
 *
 * An agent has two kinds of id. `agentId` is the organization-wide identity: it keys the agent's links and sessions here
 * and never appears on a note, an event or a page. `agentRef` is what an event carries: a fresh random id for each agent
 * on each note, kept in the `note_agent_refs` mapping below, so a borrower with two notes cannot tell that one staff
 * member acted on both.
 */

export interface OrgAgentRecord {
	agentId: string;
	role: AgentRole;
	active: boolean;
}

/** An emailed organization link: only the sha256 of its token is kept. Single use. */
export interface OrgLinkRecord {
	hash: string;
	agentId: string;
	expiresAt: string;
}

/** A signed-in agent: only the sha256 of the cookie value is kept. The role is read live from the agent row. */
export interface OrgSessionRecord {
	hash: string;
	orgId: string;
	agentId: string;
	createdAt: string;
	lastSeenAt: string;
	absoluteExpiresAt: string;
}

export interface OrgStore {
	/** Adds a note to the organization's index once; a second call changes nothing. `partyRole` is what the org reads. */
	registerNote(
		orgId: string,
		noteId: string,
		partyRole: Role,
		now: string,
	): Promise<void>;
	/** Up to `limit` note ids of the organization, in id order. */
	listNotes(orgId: string, limit: number): Promise<string[]>;
	/**
	 * Finds the agent with this address hash or creates one with `newId`, and sets its role and active flag on. The
	 * agent's id never changes after the first call.
	 */
	upsertAgent(
		orgId: string,
		entry: { newId: string; emailHash: string; role: AgentRole; now: string },
	): Promise<OrgAgentRecord>;
	findAgent(orgId: string, emailHash: string): Promise<OrgAgentRecord | null>;
	getAgent(orgId: string, agentId: string): Promise<OrgAgentRecord | null>;
	/** True when an agent of that organization exists (and now has the flag asked for). */
	setAgentActive(
		orgId: string,
		agentId: string,
		active: boolean,
	): Promise<boolean>;
	/**
	 * The `agentRef` this agent carries on this note: the existing one, or `newRef` written now. Written once, so a
	 * retried create finds the same ref. Two agents never share a ref on a note.
	 */
	bindNoteRef(
		orgId: string,
		noteId: string,
		agentId: string,
		newRef: string,
	): Promise<string>;
	/** The ref this agent carries on this note, or null when they were never registered on it. */
	noteRefOf(
		orgId: string,
		noteId: string,
		agentId: string,
	): Promise<string | null>;
	/** The agent behind a ref on this note, or null. */
	agentIdOfRef(
		orgId: string,
		noteId: string,
		agentRef: string,
	): Promise<string | null>;
	putLink(orgId: string, link: OrgLinkRecord): Promise<void>;
	/** Marks the link used and returns its agent id, or null when it is unknown, used or past `expiresAt`. */
	redeemLink(orgId: string, hash: string, now: string): Promise<string | null>;
	deleteLinksOf(orgId: string, agentId: string): Promise<void>;
	putSession(session: OrgSessionRecord): Promise<void>;
	/** The session of this organization, with its last-seen moved to `now`, or null when unknown, idle or past its end. */
	touchSession(
		orgId: string,
		hash: string,
		now: string,
		idleMs: number,
	): Promise<OrgSessionRecord | null>;
	deleteSession(orgId: string, hash: string): Promise<void>;
	deleteSessionsOf(orgId: string, agentId: string): Promise<void>;
	/** Counts one hit in a fixed window; true while the count stays within `limit`. */
	hit(
		orgId: string,
		key: string,
		now: string,
		windowMs: number,
		limit: number,
	): Promise<boolean>;
}
