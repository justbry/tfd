import type { Role } from "tfd-notes";
import type { AgentRole } from "./org";

/**
 * What the organization side keeps across notes (build step 4): the index of an organization's notes, its agents, and
 * their links, sessions and counters. It lives in D1 in the Worker (`org-d1-store.ts`, migration 0003) and in memory
 * in tests. It never holds an email address: an agent is matched by a salted hash (`emailHash`), used only to find the
 * agent a link request names. The addresses themselves live in each note's own store (`NoteStore`).
 */

export interface OrgAgentRecord {
	agentRef: string;
	role: AgentRole;
	active: boolean;
}

/** An emailed organization link: only the sha256 of its token is kept. Single use. */
export interface OrgLinkRecord {
	hash: string;
	agentRef: string;
	expiresAt: string;
}

/** A signed-in agent: only the sha256 of the cookie value is kept. The role is read live from the agent row. */
export interface OrgSessionRecord {
	hash: string;
	orgId: string;
	agentRef: string;
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
	 * Finds the agent with this address hash or creates one with `newRef`, and sets its role and active flag on. The
	 * agent's ref never changes after the first call.
	 */
	upsertAgent(
		orgId: string,
		entry: { newRef: string; emailHash: string; role: AgentRole; now: string },
	): Promise<OrgAgentRecord>;
	findAgent(orgId: string, emailHash: string): Promise<OrgAgentRecord | null>;
	getAgent(orgId: string, agentRef: string): Promise<OrgAgentRecord | null>;
	/** True when an agent of that organization exists (and now has the flag asked for). */
	setAgentActive(
		orgId: string,
		agentRef: string,
		active: boolean,
	): Promise<boolean>;
	putLink(orgId: string, link: OrgLinkRecord): Promise<void>;
	/** Marks the link used and returns its agent ref, or null when it is unknown, used or past `expiresAt`. */
	redeemLink(orgId: string, hash: string, now: string): Promise<string | null>;
	deleteLinksOf(orgId: string, agentRef: string): Promise<void>;
	putSession(session: OrgSessionRecord): Promise<void>;
	/** The session of this organization, with its last-seen moved to `now`, or null when unknown, idle or past its end. */
	touchSession(
		orgId: string,
		hash: string,
		now: string,
		idleMs: number,
	): Promise<OrgSessionRecord | null>;
	deleteSession(orgId: string, hash: string): Promise<void>;
	deleteSessionsOf(orgId: string, agentRef: string): Promise<void>;
	/** Counts one hit in a fixed window; true while the count stays within `limit`. */
	hit(
		orgId: string,
		key: string,
		now: string,
		windowMs: number,
		limit: number,
	): Promise<boolean>;
}
