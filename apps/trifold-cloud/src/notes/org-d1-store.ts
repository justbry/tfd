import type { Role } from "tfd-notes";
import type { D1Database } from "../env";
import type { AgentRole } from "./org";
import type {
	OrgAgentRecord,
	OrgLinkRecord,
	OrgSessionRecord,
	OrgStore,
} from "./org-store";

/**
 * The `OrgStore` over D1 (migrations `0003_notes_org_index.sql` and `0004_notes_agent_refs.sql`). The column
 * `agent_ref` of `org_agents`, `org_links` and `org_sessions` holds the agent's organization-wide id (`agentId`); the
 * per-note ref an event carries is `org_note_agents.agent_ref`. D1 has no interactive transaction, so every method that
 * must be atomic is one statement: a claim is an `UPDATE ... RETURNING`, a counter is an upsert with `RETURNING`, an
 * agent is found or made by one `INSERT ... ON CONFLICT ... RETURNING`.
 */

type AgentRow = { agent_ref: string; role: AgentRole; active: number };

const recordOf = (row: AgentRow): OrgAgentRecord => ({
	agentId: row.agent_ref,
	role: row.role,
	active: row.active === 1,
});

type SessionRow = {
	hash: string;
	org_id: string;
	agent_ref: string;
	created_at: string;
	last_seen_at: string;
	absolute_expires_at: string;
};

export class D1OrgStore implements OrgStore {
	constructor(private readonly db: D1Database) {}

	async registerNote(
		orgId: string,
		noteId: string,
		partyRole: Role,
		now: string,
	): Promise<void> {
		await this.db
			.prepare(
				"INSERT OR IGNORE INTO note_org_index (org_id, note_id, party_role, created_at) VALUES (?, ?, ?, ?)",
			)
			.bind(orgId, noteId, partyRole, now)
			.run();
	}

	async listNotes(orgId: string, limit: number): Promise<string[]> {
		const { results } = await this.db
			.prepare(
				"SELECT note_id FROM note_org_index WHERE org_id = ? ORDER BY note_id LIMIT ?",
			)
			.bind(orgId, limit)
			.all<{ note_id: string }>();
		return results.map((row) => row.note_id);
	}

	async upsertAgent(
		orgId: string,
		entry: { newId: string; emailHash: string; role: AgentRole; now: string },
	): Promise<OrgAgentRecord> {
		const row = await this.db
			.prepare(
				`INSERT INTO org_agents (org_id, agent_ref, email_hash, role, active, added_at) VALUES (?, ?, ?, ?, 1, ?)
				ON CONFLICT (org_id, email_hash) DO UPDATE SET role = excluded.role, active = 1
				RETURNING agent_ref, role, active`,
			)
			.bind(orgId, entry.newId, entry.emailHash, entry.role, entry.now)
			.first<AgentRow>();
		if (row === null) throw new Error("org agent was not written");
		return recordOf(row);
	}

	async findAgent(
		orgId: string,
		emailHash: string,
	): Promise<OrgAgentRecord | null> {
		const row = await this.db
			.prepare(
				"SELECT agent_ref, role, active FROM org_agents WHERE org_id = ? AND email_hash = ?",
			)
			.bind(orgId, emailHash)
			.first<AgentRow>();
		return row ? recordOf(row) : null;
	}

	async getAgent(
		orgId: string,
		agentId: string,
	): Promise<OrgAgentRecord | null> {
		const row = await this.db
			.prepare(
				"SELECT agent_ref, role, active FROM org_agents WHERE org_id = ? AND agent_ref = ?",
			)
			.bind(orgId, agentId)
			.first<AgentRow>();
		return row ? recordOf(row) : null;
	}

	async setAgentActive(
		orgId: string,
		agentId: string,
		active: boolean,
	): Promise<boolean> {
		const row = await this.db
			.prepare(
				"UPDATE org_agents SET active = ? WHERE org_id = ? AND agent_ref = ? RETURNING agent_ref",
			)
			.bind(active ? 1 : 0, orgId, agentId)
			.first<{ agent_ref: string }>();
		return row !== null;
	}

	async bindNoteRef(
		orgId: string,
		noteId: string,
		agentId: string,
		newRef: string,
	): Promise<string> {
		const row = await this.db
			.prepare(
				`INSERT INTO org_note_agents (org_id, note_id, agent_id, agent_ref) VALUES (?, ?, ?, ?)
				ON CONFLICT (org_id, note_id, agent_id) DO UPDATE SET agent_ref = org_note_agents.agent_ref
				RETURNING agent_ref`,
			)
			.bind(orgId, noteId, agentId, newRef)
			.first<{ agent_ref: string }>();
		if (row === null) throw new Error("agent ref was not written");
		return row.agent_ref;
	}

	async noteRefOf(
		orgId: string,
		noteId: string,
		agentId: string,
	): Promise<string | null> {
		const row = await this.db
			.prepare(
				"SELECT agent_ref FROM org_note_agents WHERE org_id = ? AND note_id = ? AND agent_id = ?",
			)
			.bind(orgId, noteId, agentId)
			.first<{ agent_ref: string }>();
		return row?.agent_ref ?? null;
	}

	async agentIdOfRef(
		orgId: string,
		noteId: string,
		agentRef: string,
	): Promise<string | null> {
		const row = await this.db
			.prepare(
				"SELECT agent_id FROM org_note_agents WHERE org_id = ? AND note_id = ? AND agent_ref = ?",
			)
			.bind(orgId, noteId, agentRef)
			.first<{ agent_id: string }>();
		return row?.agent_id ?? null;
	}

	async putLink(orgId: string, link: OrgLinkRecord): Promise<void> {
		await this.db
			.prepare(
				"INSERT INTO org_links (org_id, hash, agent_ref, expires_at, used_at) VALUES (?, ?, ?, ?, NULL)",
			)
			.bind(orgId, link.hash, link.agentId, link.expiresAt)
			.run();
	}

	async redeemLink(
		orgId: string,
		hash: string,
		now: string,
	): Promise<string | null> {
		const row = await this.db
			.prepare(
				`UPDATE org_links SET used_at = ?
				WHERE org_id = ? AND hash = ? AND used_at IS NULL AND expires_at > ?
				RETURNING agent_ref`,
			)
			.bind(now, orgId, hash, now)
			.first<{ agent_ref: string }>();
		return row?.agent_ref ?? null;
	}

	async deleteLinksOf(orgId: string, agentId: string): Promise<void> {
		await this.db
			.prepare("DELETE FROM org_links WHERE org_id = ? AND agent_ref = ?")
			.bind(orgId, agentId)
			.run();
	}

	async putSession(session: OrgSessionRecord): Promise<void> {
		await this.db
			.prepare(
				"INSERT INTO org_sessions (org_id, hash, agent_ref, created_at, last_seen_at, absolute_expires_at) VALUES (?, ?, ?, ?, ?, ?)",
			)
			.bind(
				session.orgId,
				session.hash,
				session.agentId,
				session.createdAt,
				session.lastSeenAt,
				session.absoluteExpiresAt,
			)
			.run();
	}

	async touchSession(
		orgId: string,
		hash: string,
		now: string,
		idleMs: number,
	): Promise<OrgSessionRecord | null> {
		const idleCutoff = new Date(Date.parse(now) - idleMs).toISOString();
		const row = await this.db
			.prepare(
				`UPDATE org_sessions SET last_seen_at = ?
				WHERE org_id = ? AND hash = ? AND absolute_expires_at > ? AND last_seen_at >= ?
				RETURNING hash, org_id, agent_ref, created_at, last_seen_at, absolute_expires_at`,
			)
			.bind(now, orgId, hash, now, idleCutoff)
			.first<SessionRow>();
		if (row === null) {
			await this.db
				.prepare(
					"DELETE FROM org_sessions WHERE org_id = ? AND hash = ? AND (absolute_expires_at <= ? OR last_seen_at < ?)",
				)
				.bind(orgId, hash, now, idleCutoff)
				.run();
			return null;
		}
		return {
			hash: row.hash,
			orgId: row.org_id,
			agentId: row.agent_ref,
			createdAt: row.created_at,
			lastSeenAt: row.last_seen_at,
			absoluteExpiresAt: row.absolute_expires_at,
		};
	}

	async deleteSession(orgId: string, hash: string): Promise<void> {
		await this.db
			.prepare("DELETE FROM org_sessions WHERE org_id = ? AND hash = ?")
			.bind(orgId, hash)
			.run();
	}

	async deleteSessionsOf(orgId: string, agentId: string): Promise<void> {
		await this.db
			.prepare("DELETE FROM org_sessions WHERE org_id = ? AND agent_ref = ?")
			.bind(orgId, agentId)
			.run();
	}

	async hit(
		orgId: string,
		key: string,
		now: string,
		windowMs: number,
		limit: number,
	): Promise<boolean> {
		const at = Date.parse(now);
		const row = await this.db
			.prepare(
				`INSERT INTO org_counters (org_id, counter_key, window_start, hits) VALUES (?, ?, ?, 1)
				ON CONFLICT (org_id, counter_key) DO UPDATE SET
					hits = CASE WHEN ? - window_start >= ? THEN 1 ELSE hits + 1 END,
					window_start = CASE WHEN ? - window_start >= ? THEN ? ELSE window_start END
				RETURNING hits`,
			)
			.bind(orgId, key, at, at, windowMs, at, windowMs, at)
			.first<{ hits: number }>();
		return row !== null && row.hits <= limit;
	}
}
