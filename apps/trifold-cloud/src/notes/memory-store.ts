import type { ChainLink, Role } from "tfd-notes";
import type {
	AgentRecord,
	AppendResult,
	AttemptResult,
	CodeRecord,
	Contacts,
	IdempotencyResult,
	InviteRecord,
	NoteStore,
	SessionRecord,
	ShareRecord,
	ShareSessionRecord,
	StoredDocument,
	StoredSeal,
} from "./store";

interface NoteData {
	events: string[];
	links: ChainLink[];
	contacts: Contacts | null;
	orgId: string | null;
	agents: Map<string, AgentRecord>;
	invites: Map<string, InviteRecord & { used: boolean }>;
	sessions: Map<string, SessionRecord>;
	codes: Map<string, CodeRecord & { attempts: number }>;
	counters: Map<string, { windowStart: number; count: number }>;
	idempotency: Map<string, string>;
	documents: StoredDocument[];
	seal: StoredSeal | null;
	shares: Map<string, ShareRecord>;
	shareSessions: Map<string, ShareSessionRecord>;
}

const instant = (value: string): number => Date.parse(value);

/** The in-memory `NoteStore`: tests and local runs. Nothing awaits inside a method, so each one is atomic. */
export class MemoryNoteStore implements NoteStore {
	private readonly notes = new Map<string, NoteData>();

	private note(noteId: string): NoteData {
		const existing = this.notes.get(noteId);
		if (existing) return existing;
		const created: NoteData = {
			events: [],
			links: [],
			contacts: null,
			orgId: null,
			agents: new Map(),
			invites: new Map(),
			sessions: new Map(),
			codes: new Map(),
			counters: new Map(),
			idempotency: new Map(),
			documents: [],
			seal: null,
			shares: new Map(),
			shareSessions: new Map(),
		};
		this.notes.set(noteId, created);
		return created;
	}

	async readLog(noteId: string) {
		const { events, links } = this.note(noteId);
		return { events: [...events], links: [...links] };
	}

	async append(
		noteId: string,
		expectedSeq: number,
		entry: { eventJson: string; link: ChainLink; document?: StoredDocument },
	): Promise<AppendResult> {
		const data = this.note(noteId);
		if (data.events.length !== expectedSeq)
			return { ok: false, reason: "conflict", seq: data.events.length };
		if (entry.link.seq !== expectedSeq + 1)
			throw new Error("append: the link does not follow expectedSeq");
		data.events.push(entry.eventJson);
		data.links.push(entry.link);
		if (entry.document) data.documents.push({ ...entry.document });
		return { ok: true };
	}

	async putDocumentOnce(
		noteId: string,
		document: StoredDocument,
	): Promise<StoredDocument> {
		const { documents } = this.note(noteId);
		const existing =
			document.eventId === null
				? undefined
				: documents.find(
						(candidate) =>
							candidate.type === document.type &&
							candidate.eventId === document.eventId,
					);
		if (existing) return { ...existing };
		documents.push({ ...document });
		return { ...document };
	}

	async getDocument(
		noteId: string,
		docId: string,
	): Promise<StoredDocument | null> {
		const found = this.note(noteId).documents.find(
			(candidate) => candidate.id === docId,
		);
		return found ? { ...found } : null;
	}

	async listDocuments(noteId: string): Promise<StoredDocument[]> {
		return this.note(noteId).documents.map((document) => ({ ...document }));
	}

	async putSeal(noteId: string, seal: StoredSeal): Promise<void> {
		const data = this.note(noteId);
		if (data.seal === null || seal.headSeq >= data.seal.headSeq)
			data.seal = { ...seal };
	}

	async getSeal(noteId: string): Promise<StoredSeal | null> {
		const { seal } = this.note(noteId);
		return seal ? { ...seal } : null;
	}

	async putContacts(noteId: string, contacts: Contacts): Promise<void> {
		const data = this.note(noteId);
		data.contacts ??= { ...contacts };
	}

	async getContacts(noteId: string): Promise<Contacts | null> {
		const { contacts } = this.note(noteId);
		return contacts ? { ...contacts } : null;
	}

	async putOrg(noteId: string, orgId: string): Promise<void> {
		const data = this.note(noteId);
		data.orgId ??= orgId;
	}

	async getOrg(noteId: string): Promise<string | null> {
		return this.note(noteId).orgId;
	}

	async putAgent(noteId: string, agent: AgentRecord): Promise<void> {
		this.note(noteId).agents.set(agent.agentRef, { ...agent });
	}

	async getAgent(
		noteId: string,
		agentRef: string,
	): Promise<AgentRecord | null> {
		const found = this.note(noteId).agents.get(agentRef);
		return found ? { ...found } : null;
	}

	async listAgents(noteId: string): Promise<AgentRecord[]> {
		return [...this.note(noteId).agents.values()].map((agent) => ({
			...agent,
		}));
	}

	async setAgentActive(
		noteId: string,
		agentRef: string,
		active: boolean,
	): Promise<boolean> {
		const found = this.note(noteId).agents.get(agentRef);
		if (!found) return false;
		found.active = active;
		return true;
	}

	async putInvite(noteId: string, invite: InviteRecord): Promise<void> {
		this.note(noteId).invites.set(invite.hash, { ...invite, used: false });
	}

	async redeemInvite(
		noteId: string,
		hash: string,
		now: string,
	): Promise<Role | null> {
		const invite = this.note(noteId).invites.get(hash);
		if (!invite || invite.used || instant(now) >= instant(invite.expiresAt))
			return null;
		invite.used = true;
		return invite.role;
	}

	async putSession(noteId: string, session: SessionRecord): Promise<void> {
		this.note(noteId).sessions.set(session.hash, { ...session });
	}

	async touchSession(
		noteId: string,
		hash: string,
		now: string,
		idleMs: number,
	): Promise<SessionRecord | null> {
		const { sessions } = this.note(noteId);
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

	async deleteSession(noteId: string, hash: string): Promise<void> {
		this.note(noteId).sessions.delete(hash);
	}

	async putCode(
		noteId: string,
		sessionHash: string,
		code: CodeRecord,
	): Promise<void> {
		this.note(noteId).codes.set(sessionHash, { ...code, attempts: 0 });
	}

	async takeAttempt(
		noteId: string,
		sessionHash: string,
		now: string,
		maxAttempts: number,
	): Promise<AttemptResult> {
		const { codes } = this.note(noteId);
		const code = codes.get(sessionHash);
		if (!code) return { status: "none" };
		if (instant(now) >= instant(code.expiresAt)) {
			codes.delete(sessionHash);
			return { status: "expired" };
		}
		if (code.attempts >= maxAttempts) return { status: "locked" };
		code.attempts += 1;
		return { status: "ok", codeHash: code.codeHash, action: code.action };
	}

	async clearCode(noteId: string, sessionHash: string): Promise<boolean> {
		return this.note(noteId).codes.delete(sessionHash);
	}

	async hit(
		noteId: string,
		key: string,
		now: string,
		windowMs: number,
		limit: number,
	): Promise<boolean> {
		const { counters } = this.note(noteId);
		const current = counters.get(key);
		const at = instant(now);
		if (!current || at - current.windowStart >= windowMs) {
			counters.set(key, { windowStart: at, count: 1 });
			return limit >= 1;
		}
		current.count += 1;
		return current.count <= limit;
	}

	async claimIdempotency(
		noteId: string,
		caller: string,
		key: string,
		fingerprint: string,
	): Promise<IdempotencyResult> {
		const { idempotency } = this.note(noteId);
		const slot = `${caller}\n${key}`;
		const existing = idempotency.get(slot);
		if (existing === undefined) {
			idempotency.set(slot, fingerprint);
			return "new";
		}
		return existing === fingerprint ? "same" : "different";
	}

	async putShare(noteId: string, share: ShareRecord): Promise<void> {
		const { shares } = this.note(noteId);
		if (!shares.has(share.grantId)) shares.set(share.grantId, { ...share });
	}

	async getShare(noteId: string, grantId: string): Promise<ShareRecord | null> {
		const found = this.note(noteId).shares.get(grantId);
		return found ? { ...found } : null;
	}

	async listShares(noteId: string): Promise<ShareRecord[]> {
		return [...this.note(noteId).shares.values()].map((share) => ({
			...share,
		}));
	}

	async issueShareLink(
		noteId: string,
		grantId: string,
		hash: string,
		replace: boolean,
	): Promise<boolean> {
		const share = this.note(noteId).shares.get(grantId);
		if (!share || (share.linkHash !== null && !replace)) return false;
		share.linkHash = hash;
		share.linkUsedAt = null;
		return true;
	}

	async claimShareLink(
		noteId: string,
		grantId: string,
		hash: string,
		now: string,
	): Promise<boolean> {
		const share = this.note(noteId).shares.get(grantId);
		if (!share || share.linkHash !== hash || share.linkUsedAt !== null)
			return false;
		share.linkUsedAt = now;
		return true;
	}

	async putShareSession(
		noteId: string,
		session: ShareSessionRecord,
	): Promise<void> {
		this.note(noteId).shareSessions.set(session.hash, { ...session });
	}

	async getShareSession(
		noteId: string,
		hash: string,
		now: string,
	): Promise<ShareSessionRecord | null> {
		const { shareSessions } = this.note(noteId);
		const session = shareSessions.get(hash);
		if (!session) return null;
		if (instant(now) >= instant(session.absoluteExpiresAt)) {
			shareSessions.delete(hash);
			return null;
		}
		return { ...session };
	}

	/** Test hook: replaces the stored JSON of event `seq` without touching its chain link (what tampering looks like). */
	tamperEventForTest(noteId: string, seq: number, eventJson: string): void {
		this.note(noteId).events[seq - 1] = eventJson;
	}

	/** Test hook: how many notes the store holds (a probe that a note was or was not created). */
	get size(): number {
		return this.notes.size;
	}
}
