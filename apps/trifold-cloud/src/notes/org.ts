import { type ApprovalPolicy, sha256Hex } from "tfd-notes";

/**
 * Organizations as parties (docs/specs/promissory-notes.md build step 4). An organization is the lender and acts through
 * agents: people it registered by email. This file holds the vocabulary the store, the service and the pages share.
 */

/** `treasurer` may act, `board` may act and approve, `viewer` only reads. */
export const AGENT_ROLES = ["treasurer", "board", "viewer"] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export const isAgentRole = (value: unknown): value is AgentRole =>
	AGENT_ROLES.some((role) => role === value);

/** Who is acting for an organization on one note. `agentRef` is the opaque id stamped on every event they enter. */
export interface AgentIdentity {
	orgId: string;
	agentRef: string;
	role: AgentRole;
}

/** An organization id is an opaque string the API caller chooses: 1 to 64 letters, digits, `_` or `-`. */
export const ORG_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export const MAX_AGENTS_PER_REQUEST = 20;

/**
 * What needs two agents when the lender is an organization: confirming a release, a default notice and a waiver. A
 * person lender has no such policy (`tfd-notes` `checkAppend` then lets those events through).
 */
export const ORG_POLICY: ApprovalPolicy = {
	twoPerson: new Set(["release.confirm", "notice.default", "waiver"]),
};

export const NO_APPROVALS: ApprovalPolicy = { twoPerson: new Set() };

/**
 * The hash the org index keeps instead of an address: sha256 of the address under `NOTES_SESSION_SECRET` and the
 * organization id. It is used only to match an address typed into a link request; the address itself is never stored
 * in the index.
 */
export const emailHash = (
	secret: string,
	orgId: string,
	normalizedEmail: string,
): Promise<string> =>
	sha256Hex(`tfd.org-agent.v1:${secret}\n${orgId}\n${normalizedEmail}`);

/** The message the CSRF token of an organization session signs, whether the form is on the portfolio or on a note. */
export const orgCsrfMessage = (orgId: string, sessionHash: string): string =>
	`csrf:org:${orgId}:${sessionHash}`;

/** The path of a note's page for an organization agent. */
export const orgNotePath = (orgId: string, noteId: string): string =>
	`/o/${orgId}/n/${noteId}`;
