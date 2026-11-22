// SPDX-License-Identifier: Apache-2.0
/**
 * Who may see a note beyond its two parties (docs/specs/promissory-notes.md, plan decision D1). A grant is proposed by
 * one party; a normal grant is live only when both parties consented, a carve-out grant (the typed disclosure to a
 * person who needs it for their own books, legal advice, enforcement or assignment; at most 90 days, at statement level
 * or below) is live on its proposer's consent alone but is always listed for both parties. Either party may revoke any
 * grant at any time. A pure fold over the event stream and an instant: no clock, no store.
 */

import { validateStream } from "./events";
import { compareInstants } from "./instant";
import type {
	GrantAudience,
	GrantLevel,
	GrantProposedEvent,
	GrantPurpose,
	NoteEvent,
	Role,
	VisibilityChangedEvent,
} from "./types";

/** What a party is told before they revoke. The UI must show this exact text. */
export const REVOKE_NOTICE =
	"Revoking stops later reads. It cannot take back what the person already saw.";

export type GrantStatus = "pending" | "active" | "expired" | "revoked";

export interface Grant {
	grant_id: string;
	audience: GrantAudience;
	level: GrantLevel;
	proposed_by: Role;
	proposed_at: string;
	expires_at: string;
	purpose?: GrantPurpose;
	carve_out: boolean;
	/** Each role that consented, the proposer first. */
	consented_by: Role[];
	/** The role that revoked, or null while nobody has. */
	revoked_by: Role | null;
	status: GrantStatus;
}

/** One carve-out disclosure as both parties see it. Never hidden, even once revoked or expired. */
export interface DisclosureEntry {
	grant_id: string;
	purpose: GrantPurpose;
	audience_kind: GrantAudience["kind"];
	proposed_by: Role;
	proposed_at: string;
	expires_at: string;
	status: GrantStatus;
}

const BOTH_ROLES: readonly Role[] = ["lender", "borrower"];

const isVisibilityChange = (
	event: NoteEvent,
): event is VisibilityChangedEvent => event.type === "visibility.changed";

const startGrant = (event: GrantProposedEvent): Grant => {
	const grant: Grant = {
		grant_id: event.grant_id,
		audience: event.audience,
		level: event.level,
		proposed_by: event.entered_by,
		proposed_at: event.entered_at,
		expires_at: event.expires_at,
		carve_out: event.carve_out === true,
		consented_by: [event.entered_by],
		revoked_by: null,
		status: "pending",
	};
	if (event.purpose !== undefined) {
		grant.purpose = event.purpose;
	}
	return grant;
};

/** A normal grant needs both roles; a carve-out grant needs only its proposer, who always consents by proposing. */
const hasEnoughConsent = (grant: Grant): boolean =>
	grant.carve_out ||
	BOTH_ROLES.every((role) => grant.consented_by.includes(role));

const statusAt = (grant: Grant, asOfInstant: string): GrantStatus => {
	if (grant.revoked_by !== null) {
		return "revoked";
	}
	if (compareInstants(asOfInstant, grant.expires_at) >= 0) {
		return "expired";
	}
	return hasEnoughConsent(grant) ? "active" : "pending";
};

/**
 * Every grant in the stream with its status at `asOfInstant`, in the order proposed. Events entered after the instant
 * have not happened yet and are ignored. The proposer's role counts as consent. A second consent by a role that already
 * consented changes nothing, and neither does a consent after a revocation. The first revocation wins over everything,
 * and an expiry (the instant is at or after `expires_at`) beats consent. Throws when the stream is invalid.
 */
export const grantsOf = (events: unknown[], asOfInstant: string): Grant[] => {
	const grants = new Map<string, Grant>();
	for (const event of validateStream(events)) {
		if (
			!isVisibilityChange(event) ||
			compareInstants(event.entered_at, asOfInstant) > 0
		) {
			continue;
		}
		if (event.change === "grant.proposed") {
			grants.set(event.grant_id, startGrant(event));
			continue;
		}
		const grant = grants.get(event.grant_id);
		if (grant === undefined || grant.revoked_by !== null) {
			continue;
		}
		if (event.change === "grant.revoked") {
			grant.revoked_by = event.entered_by;
		} else if (!grant.consented_by.includes(event.entered_by)) {
			grant.consented_by.push(event.entered_by);
		}
	}
	const folded = [...grants.values()];
	for (const grant of folded) {
		grant.status = statusAt(grant, asOfInstant);
	}
	return folded;
};

/** The grants that may be read at `asOfInstant`: consented as required, not expired, not revoked. */
export const activeGrants = (events: unknown[], asOfInstant: string): Grant[] =>
	grantsOf(events, asOfInstant).filter((grant) => grant.status === "active");

/**
 * The disclosure log: every carve-out grant, whatever its status, for both parties to see. A carve-out is live on its
 * proposer's consent alone, so this list is how the other party always learns of it.
 */
export const disclosureLog = (
	events: unknown[],
	asOfInstant: string,
): DisclosureEntry[] => {
	const log: DisclosureEntry[] = [];
	for (const grant of grantsOf(events, asOfInstant)) {
		if (!grant.carve_out) {
			continue;
		}
		if (grant.purpose === undefined) {
			throw new Error(`Carve-out grant ${grant.grant_id} has no purpose`);
		}
		log.push({
			grant_id: grant.grant_id,
			purpose: grant.purpose,
			audience_kind: grant.audience.kind,
			proposed_by: grant.proposed_by,
			proposed_at: grant.proposed_at,
			expires_at: grant.expires_at,
			status: grant.status,
		});
	}
	return log;
};
