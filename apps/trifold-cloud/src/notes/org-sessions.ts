import { sha256Hex } from "tfd-notes";
import { type AgentRole, orgCsrfMessage } from "./org";
import type { OrgStore } from "./org-store";
import type { Clock, IdSource } from "./ports";
import {
	COOKIE_ATTRIBUTES,
	constantTimeEqual,
	hmac,
	INVITE_TTL_MS,
	readCookie,
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

/** One cookie name per organization (`__Host-` needs `Path=/`, so the scope is in the name). */
export const orgSessionCookieName = (orgId: string): string =>
	`__Host-tf_org_${orgId}`;

export const orgSessionCookie = (
	orgId: string,
	value: string,
	maxAgeSeconds: number,
): string =>
	`${orgSessionCookieName(orgId)}=${value}; ${COOKIE_ATTRIBUTES}; Max-Age=${maxAgeSeconds}`;

export const clearedOrgSessionCookie = (orgId: string): string =>
	`${orgSessionCookieName(orgId)}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`;

export const readOrgSessionCookie = (
	header: string | null,
	orgId: string,
): string | null => readCookie(header, orgSessionCookieName(orgId));

/**
 * A signed-in agent. `hash` is the key of the session row, not the cookie. `agentId` is the agent's organization-wide
 * identity: it never reaches a note, an event or a page (a note carries a per-note `agentRef`).
 */
export interface OrgSession {
	orgId: string;
	agentId: string;
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
	async issueLink(
		orgId: string,
		agentId: string,
		options: { replace?: boolean } = {},
	): Promise<string> {
		if (options.replace) await this.deps.orgs.deleteLinksOf(orgId, agentId);
		const token = this.deps.ids.token(TOKEN_BYTES);
		await this.deps.orgs.putLink(orgId, {
			hash: await sha256Hex(token),
			agentId,
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
		const agentId = await orgs.redeemLink(orgId, await sha256Hex(token), now);
		if (agentId === null) return null;
		const agent = await orgs.getAgent(orgId, agentId);
		if (!agent?.active) return null;
		const cookieValue = ids.token(TOKEN_BYTES);
		await orgs.putSession({
			hash: await sha256Hex(cookieValue),
			orgId,
			agentId,
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
		const agent = await this.deps.orgs.getAgent(orgId, record.agentId);
		if (!agent?.active) return null;
		return { orgId, agentId: record.agentId, role: agent.role, hash };
	}

	/** Ends this one session on the server: its cookie opens nothing from now on. */
	end(session: Pick<OrgSession, "orgId" | "hash">): Promise<void> {
		return this.deps.orgs.deleteSession(session.orgId, session.hash);
	}

	/** Ends every live session and pending link of an agent. */
	async revokeAgent(orgId: string, agentId: string): Promise<void> {
		await this.deps.orgs.deleteSessionsOf(orgId, agentId);
		await this.deps.orgs.deleteLinksOf(orgId, agentId);
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
