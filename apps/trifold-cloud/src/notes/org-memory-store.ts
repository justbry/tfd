import type { Role } from "tfd-notes";
import type { AgentRole } from "./org";
import type {
	OrgAgentRecord,
	OrgLinkRecord,
	OrgSessionRecord,
	OrgStore,
} from "./org-store";

interface AgentRow {
	agentRef: string;
	emailHash: string;
	role: AgentRole;
	active: boolean;
}

interface OrgData {
	notes: Map<string, Role>;
	agents: Map<string, AgentRow>;
	links: Map<string, OrgLinkRecord & { used: boolean }>;
	sessions: Map<string, OrgSessionRecord>;
	counters: Map<string, { windowStart: number; count: number }>;
}

const instant = (value: string): number => Date.parse(value);

const recordOf = (row: AgentRow): OrgAgentRecord => ({
	agentRef: row.agentRef,
	role: row.role,
	active: row.active,
});

/** The in-memory `OrgStore`: tests and local runs. Nothing awaits inside a method, so each one is atomic. */
export class MemoryOrgStore implements OrgStore {
	private readonly orgs = new Map<string, OrgData>();

	private org(orgId: string): OrgData {
		const existing = this.orgs.get(orgId);
		if (existing) return existing;
		const created: OrgData = {
			notes: new Map(),
			agents: new Map(),
			links: new Map(),
			sessions: new Map(),
			counters: new Map(),
		};
		this.orgs.set(orgId, created);
		return created;
	}

	async registerNote(
		orgId: string,
		noteId: string,
		partyRole: Role,
	): Promise<void> {
		const { notes } = this.org(orgId);
		if (!notes.has(noteId)) notes.set(noteId, partyRole);
	}

	async listNotes(orgId: string, limit: number): Promise<string[]> {
		return [...this.org(orgId).notes.keys()].sort().slice(0, limit);
	}

	async upsertAgent(
		orgId: string,
		entry: { newRef: string; emailHash: string; role: AgentRole },
	): Promise<OrgAgentRecord> {
		const { agents } = this.org(orgId);
		const existing = [...agents.values()].find(
			(row) => row.emailHash === entry.emailHash,
		);
		if (existing) {
			existing.role = entry.role;
			existing.active = true;
			return recordOf(existing);
		}
		const created: AgentRow = {
			agentRef: entry.newRef,
			emailHash: entry.emailHash,
			role: entry.role,
			active: true,
		};
		agents.set(created.agentRef, created);
		return recordOf(created);
	}

	async findAgent(
		orgId: string,
		emailHash: string,
	): Promise<OrgAgentRecord | null> {
		const found = [...this.org(orgId).agents.values()].find(
			(row) => row.emailHash === emailHash,
		);
		return found ? recordOf(found) : null;
	}

	async getAgent(
		orgId: string,
		agentRef: string,
	): Promise<OrgAgentRecord | null> {
		const found = this.org(orgId).agents.get(agentRef);
		return found ? recordOf(found) : null;
	}

	async setAgentActive(
		orgId: string,
		agentRef: string,
		active: boolean,
	): Promise<boolean> {
		const found = this.org(orgId).agents.get(agentRef);
		if (!found) return false;
		found.active = active;
		return true;
	}

	async putLink(orgId: string, link: OrgLinkRecord): Promise<void> {
		this.org(orgId).links.set(link.hash, { ...link, used: false });
	}

	async redeemLink(
		orgId: string,
		hash: string,
		now: string,
	): Promise<string | null> {
		const link = this.org(orgId).links.get(hash);
		if (!link || link.used || instant(now) >= instant(link.expiresAt))
			return null;
		link.used = true;
		return link.agentRef;
	}

	async deleteLinksOf(orgId: string, agentRef: string): Promise<void> {
		const { links } = this.org(orgId);
		for (const [hash, link] of [...links]) {
			if (link.agentRef === agentRef) links.delete(hash);
		}
	}

	async putSession(session: OrgSessionRecord): Promise<void> {
		this.org(session.orgId).sessions.set(session.hash, { ...session });
	}

	async touchSession(
		orgId: string,
		hash: string,
		now: string,
		idleMs: number,
	): Promise<OrgSessionRecord | null> {
		const { sessions } = this.org(orgId);
		const session = sessions.get(hash);
		if (!session) return null;
		const expired =
			instant(now) >= instant(session.absoluteExpiresAt) ||
			instant(now) - instant(session.lastSeenAt) > idleMs;
		if (expired) {
			sessions.delete(hash);
			return null;
		}
		session.lastSeenAt = now;
		return { ...session };
	}

	async deleteSession(orgId: string, hash: string): Promise<void> {
		this.org(orgId).sessions.delete(hash);
	}

	async deleteSessionsOf(orgId: string, agentRef: string): Promise<void> {
		const { sessions } = this.org(orgId);
		for (const [hash, session] of [...sessions]) {
			if (session.agentRef === agentRef) sessions.delete(hash);
		}
	}

	async hit(
		orgId: string,
		key: string,
		now: string,
		windowMs: number,
		limit: number,
	): Promise<boolean> {
		const { counters } = this.org(orgId);
		const current = counters.get(key);
		const at = instant(now);
		if (!current || at - current.windowStart >= windowMs) {
			counters.set(key, { windowStart: at, count: 1 });
			return limit >= 1;
		}
		current.count += 1;
		return current.count <= limit;
	}

	/** Test hook: every address hash and note id the index holds, to check it keeps no address. */
	dumpForTest(): string {
		return JSON.stringify(
			[...this.orgs].map(([orgId, data]) => ({
				orgId,
				notes: [...data.notes],
				agents: [...data.agents.values()],
			})),
		);
	}
}
