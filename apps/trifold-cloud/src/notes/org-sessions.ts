import { sha256Hex } from "tfd-notes";
import { type AgentRole, orgCsrfMessage } from "./org";
import type { OrgStore } from "./org-store";
import type { Clock, IdSource } from "./ports";
import {
	constantTimeEqual,
	hmac,
	INVITE_TTL_MS,
	SESSION_ABSOLUTE_MS,
	SESSION_IDLE_MS,
} from "./sessions";

/**
 * Links and sessions for an organization's agents (build step 4). The mechanics are those of a note link
 * (`sessions.ts`): a link is single use and GET never redeems it, only hashes are stored, and the cookie is HttpOnly and
 * scoped to `/o/:orgId`. The role is not stored on the session: it is read from the agent row at every request, so
 * deactivating an agent or changing a role takes effect at once.
 */

const SECOND_MS = 1000;
const TOKEN_BYTES = 32;

export const ORG_SESSION_COOKIE = "__Secure-tf_org";

export const orgSessionCookie = (
	orgId: string,
	value: string,
	maxAgeSeconds: number,
): string =>
	`${ORG_SESSION_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/o/${orgId}; Max-Age=${maxAgeSeconds}`;

export const clearedOrgSessionCookie = (orgId: string): string =>
	`${ORG_SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/o/${orgId}; Max-Age=0`;

export const readOrgSessionCookie = (header: string | null): string | null => {
	if (!header) return null;
	for (const part of header.split(";")) {
		const [name, ...rest] = part.trim().split("=");
		if (name === ORG_SESSION_COOKIE) return rest.join("=") || null;
	}
	return null;
};

/** A signed-in agent. `hash` is the key of the session row, not the cookie. */
export interface OrgSession {
	orgId: string;
	agentRef: string;
	role: AgentRole;
	hash: string;
}

export class OrgSessionManager {
	constructor(
		private readonly deps: {
			orgs: OrgStore;
			clock: Clock;
			ids: IdSource;
			secret: string;
		},
	) {}

	private after(ms: number): string {
		return new Date(Date.parse(this.deps.clock.now()) + ms).toISOString();
	}

	/** A fresh single-use link token for one agent. Returns the token; the store keeps its hash. */
	async issueLink(orgId: string, agentRef: string): Promise<string> {
		const token = this.deps.ids.token(TOKEN_BYTES);
		await this.deps.orgs.putLink(orgId, {
			hash: await sha256Hex(token),
			agentRef,
			expiresAt: this.after(INVITE_TTL_MS),
		});
		return token;
	}

	/** Uses the link once and opens a session for its agent, if that agent is still active. */
	async redeem(
		orgId: string,
		token: string,
	): Promise<{ cookieValue: string; maxAgeSeconds: number } | null> {
		const { orgs, clock, ids } = this.deps;
		const now = clock.now();
		const agentRef = await orgs.redeemLink(orgId, await sha256Hex(token), now);
		if (agentRef === null) return null;
		const agent = await orgs.getAgent(orgId, agentRef);
		if (!agent?.active) return null;
		const cookieValue = ids.token(TOKEN_BYTES);
		await orgs.putSession({
			hash: await sha256Hex(cookieValue),
			orgId,
			agentRef,
			createdAt: now,
			lastSeenAt: now,
			absoluteExpiresAt: this.after(SESSION_ABSOLUTE_MS),
		});
		return {
			cookieValue,
			maxAgeSeconds: Math.floor(SESSION_ABSOLUTE_MS / SECOND_MS),
		};
	}

	/**
	 * The live session behind a cookie value, or null. It must belong to `orgId` (a session of another organization is
	 * not found here) and its agent must be active; the role is the agent's role now.
	 */
	async resolve(
		orgId: string,
		cookieValue: string | null,
	): Promise<OrgSession | null> {
		if (cookieValue === null) return null;
		const hash = await sha256Hex(cookieValue);
		const record = await this.deps.orgs.touchSession(
			orgId,
			hash,
			this.deps.clock.now(),
			SESSION_IDLE_MS,
		);
		if (record === null || record.orgId !== orgId) return null;
		const agent = await this.deps.orgs.getAgent(orgId, record.agentRef);
		if (!agent?.active) return null;
		return { orgId, agentRef: record.agentRef, role: agent.role, hash };
	}

	/** Ends every live session and pending link of an agent. */
	async revokeAgent(orgId: string, agentRef: string): Promise<void> {
		await this.deps.orgs.deleteSessionsOf(orgId, agentRef);
		await this.deps.orgs.deleteLinksOf(orgId, agentRef);
	}

	csrfToken(session: Pick<OrgSession, "orgId" | "hash">): Promise<string> {
		return hmac(this.deps.secret, orgCsrfMessage(session.orgId, session.hash));
	}

	async checkCsrf(
		session: Pick<OrgSession, "orgId" | "hash">,
		supplied: string | null,
	): Promise<boolean> {
		if (supplied === null) return false;
		return constantTimeEqual(await this.csrfToken(session), supplied);
	}
}
