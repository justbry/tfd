import type { ChainLink, Role } from "tfd-notes";
import type { SqlDatabase } from "../../../../packages/atm/src/cloud.ts";
import { durableSqlDatabase } from "../do-sql";
import type { DurableObjectNamespace } from "../env";
import type { DurableObjectState } from "../org-do";
import type { AgentRole } from "./org";
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

/**
 * Numbered schema steps for one note's Durable Object, applied in order the first time it wakes after a deploy, each
 * in its own transaction (the same scheme as `ORG_MIGRATIONS`). Never edit a released step; add the next one.
 */
export const NOTE_MIGRATIONS: readonly string[] = [
	`CREATE TABLE IF NOT EXISTS note_events (
		seq INTEGER PRIMARY KEY,
		event TEXT NOT NULL,
		event_id TEXT NOT NULL,
		event_hash TEXT NOT NULL,
		prev_hash TEXT NOT NULL
	);
	CREATE TABLE IF NOT EXISTS note_contacts (
		role TEXT PRIMARY KEY,
		email TEXT NOT NULL
	);
	CREATE TABLE IF NOT EXISTS note_invites (
		hash TEXT PRIMARY KEY,
		role TEXT NOT NULL,
		expires_at TEXT NOT NULL,
		used_at TEXT
	);
	CREATE TABLE IF NOT EXISTS note_sessions (
		hash TEXT PRIMARY KEY,
		role TEXT NOT NULL,
		created_at TEXT NOT NULL,
		last_seen_at TEXT NOT NULL,
		absolute_expires_at TEXT NOT NULL
	);
	CREATE TABLE IF NOT EXISTS note_codes (
		session_hash TEXT PRIMARY KEY,
		code_hash TEXT NOT NULL,
		action TEXT NOT NULL,
		expires_at TEXT NOT NULL,
		attempts INTEGER NOT NULL DEFAULT 0
	);
	CREATE TABLE IF NOT EXISTS note_counters (
		counter_key TEXT PRIMARY KEY,
		window_start INTEGER NOT NULL,
		hits INTEGER NOT NULL
	);
	CREATE TABLE IF NOT EXISTS note_idempotency (
		caller TEXT NOT NULL,
		idem_key TEXT NOT NULL,
		fingerprint TEXT NOT NULL,
		PRIMARY KEY (caller, idem_key)
	)`,
	// Step 3: signed documents and the latest chain seal. One document per (type, event) when it names an event.
	`CREATE TABLE IF NOT EXISTS note_documents (
		position INTEGER PRIMARY KEY AUTOINCREMENT,
		doc_id TEXT NOT NULL UNIQUE,
		note_id TEXT NOT NULL,
		doc_type TEXT NOT NULL,
		event_id TEXT,
		sha256 TEXT NOT NULL,
		body TEXT NOT NULL,
		created_at TEXT NOT NULL
	);
	CREATE UNIQUE INDEX IF NOT EXISTS note_documents_event
		ON note_documents (doc_type, event_id) WHERE event_id IS NOT NULL;
	CREATE TABLE IF NOT EXISTS note_seal (
		slot INTEGER PRIMARY KEY CHECK (slot = 1),
		head_seq INTEGER NOT NULL,
		sealed_at TEXT NOT NULL,
		body TEXT NOT NULL
	)`,
	// Step 4: the lender is an organization, and the agents it registered on this note (the only place their emails are kept).
	`CREATE TABLE IF NOT EXISTS note_org (
		slot INTEGER PRIMARY KEY CHECK (slot = 1),
		org_id TEXT NOT NULL
	);
	CREATE TABLE IF NOT EXISTS note_agents (
		position INTEGER PRIMARY KEY AUTOINCREMENT,
		agent_ref TEXT NOT NULL UNIQUE,
		email TEXT NOT NULL,
		role TEXT NOT NULL,
		active INTEGER NOT NULL,
		added_at TEXT NOT NULL
	)`,
	// Step 5: shares (the only place a recipient's address is kept) and the sessions of people who opened one.
	`CREATE TABLE IF NOT EXISTS note_shares (
		position INTEGER PRIMARY KEY AUTOINCREMENT,
		grant_id TEXT NOT NULL UNIQUE,
		kind TEXT NOT NULL,
		audience_ref TEXT NOT NULL,
		recipient_email TEXT,
		link_hash TEXT,
		link_used_at TEXT,
		created_at TEXT NOT NULL
	);
	CREATE TABLE IF NOT EXISTS note_share_sessions (
		hash TEXT PRIMARY KEY,
		grant_id TEXT NOT NULL,
		created_at TEXT NOT NULL,
		absolute_expires_at TEXT NOT NULL
	)`,
];

export const migrateNote = (state: DurableObjectState): number => {
	const { sql } = state.storage;
	const db = durableSqlDatabase(state.storage);
	sql.exec(
		"CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)",
	);
	const [row] = sql.exec("SELECT version FROM schema_version").toArray();
	let version = typeof row?.version === "number" ? row.version : 0;
	if (row === undefined)
		sql.exec("INSERT INTO schema_version (version) VALUES (0)");
	for (; version < NOTE_MIGRATIONS.length; version += 1) {
		const step = NOTE_MIGRATIONS[version] as string;
		state.storage.transactionSync(() => {
			db.exec(step);
			sql.exec("UPDATE schema_version SET version = ?", version + 1);
		});
	}
	return version;
};

const instant = (value: string): number => Date.parse(value);

type DocumentRow = {
	doc_id: string;
	doc_type: StoredDocument["type"];
	event_id: string | null;
	sha256: string;
	body: string;
	created_at: string;
};

const DOCUMENT_COLUMNS = "doc_id, doc_type, event_id, sha256, body, created_at";

const documentOf = (row: DocumentRow): StoredDocument => ({
	id: row.doc_id,
	type: row.doc_type,
	eventId: row.event_id,
	sha256: row.sha256,
	json: row.body,
	createdAt: row.created_at,
});

type AgentRow = {
	agent_ref: string;
	email: string;
	role: AgentRole;
	active: number;
	added_at: string;
};

const AGENT_COLUMNS = "agent_ref, email, role, active, added_at";

const agentOf = (row: AgentRow): AgentRecord => ({
	agentRef: row.agent_ref,
	email: row.email,
	role: row.role,
	active: row.active === 1,
	addedAt: row.added_at,
});

type ShareRow = {
	grant_id: string;
	kind: ShareRecord["kind"];
	audience_ref: string;
	recipient_email: string | null;
	link_hash: string | null;
	link_used_at: string | null;
	created_at: string;
};

const SHARE_COLUMNS =
	"grant_id, kind, audience_ref, recipient_email, link_hash, link_used_at, created_at";

const shareOf = (row: ShareRow): ShareRecord => ({
	grantId: row.grant_id,
	kind: row.kind,
	audienceRef: row.audience_ref,
	recipientEmail: row.recipient_email,
	linkHash: row.link_hash,
	linkUsedAt: row.link_used_at,
	createdAt: row.created_at,
});

type EventRow = {
	seq: number;
	event: string;
	event_id: string;
	event_hash: string;
	prev_hash: string;
};

/**
 * The `NoteStore` over one note's Durable Object SQLite. The object serves one note, so `noteId` is accepted for the
 * interface and not used in a query. Each method runs in a transaction; the object runs one call at a time.
 */
export class SqliteNoteStore implements NoteStore {
	private readonly db: SqlDatabase;

	constructor(state: DurableObjectState) {
		this.db = durableSqlDatabase(state.storage);
	}

	async readLog(_noteId: string) {
		const rows = this.db.all<EventRow>(
			"SELECT seq, event, event_id, event_hash, prev_hash FROM note_events ORDER BY seq",
		);
		return {
			events: rows.map((row) => row.event),
			links: rows.map(
				(row): ChainLink => ({
					seq: row.seq,
					event_id: row.event_id,
					event_hash: row.event_hash,
					prev_hash: row.prev_hash,
				}),
			),
		};
	}

	async append(
		noteId: string,
		expectedSeq: number,
		entry: { eventJson: string; link: ChainLink; document?: StoredDocument },
	): Promise<AppendResult> {
		if (entry.link.seq !== expectedSeq + 1)
			throw new Error("append: the link does not follow expectedSeq");
		return this.db.transaction((): AppendResult => {
			const [head] = this.db.all<{ seq: number }>(
				"SELECT COALESCE(MAX(seq), 0) AS seq FROM note_events",
			);
			const current = head?.seq ?? 0;
			if (current !== expectedSeq)
				return { ok: false, reason: "conflict", seq: current };
			this.db.run(
				"INSERT INTO note_events (seq, event, event_id, event_hash, prev_hash) VALUES (?, ?, ?, ?, ?)",
				[
					entry.link.seq,
					entry.eventJson,
					entry.link.event_id,
					entry.link.event_hash,
					entry.link.prev_hash,
				],
			);
			if (entry.document) this.insertDocument(noteId, entry.document);
			return { ok: true };
		});
	}

	private insertDocument(noteId: string, document: StoredDocument): void {
		this.db.run(
			"INSERT INTO note_documents (doc_id, note_id, doc_type, event_id, sha256, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
			[
				document.id,
				noteId,
				document.type,
				document.eventId,
				document.sha256,
				document.json,
				document.createdAt,
			],
		);
	}

	async putDocumentOnce(
		noteId: string,
		document: StoredDocument,
	): Promise<StoredDocument> {
		return this.db.transaction((): StoredDocument => {
			if (document.eventId !== null) {
				const [existing] = this.db.all<DocumentRow>(
					`SELECT ${DOCUMENT_COLUMNS} FROM note_documents WHERE note_id = ? AND doc_type = ? AND event_id = ?`,
					[noteId, document.type, document.eventId],
				);
				if (existing) return documentOf(existing);
			}
			this.insertDocument(noteId, document);
			return document;
		});
	}

	async getDocument(
		noteId: string,
		docId: string,
	): Promise<StoredDocument | null> {
		const [row] = this.db.all<DocumentRow>(
			`SELECT ${DOCUMENT_COLUMNS} FROM note_documents WHERE note_id = ? AND doc_id = ?`,
			[noteId, docId],
		);
		return row ? documentOf(row) : null;
	}

	async listDocuments(noteId: string): Promise<StoredDocument[]> {
		return this.db
			.all<DocumentRow>(
				`SELECT ${DOCUMENT_COLUMNS} FROM note_documents WHERE note_id = ? ORDER BY position`,
				[noteId],
			)
			.map(documentOf);
	}

	async putSeal(_noteId: string, seal: StoredSeal): Promise<void> {
		this.db.run(
			`INSERT INTO note_seal (slot, head_seq, sealed_at, body) VALUES (1, ?, ?, ?)
			ON CONFLICT (slot) DO UPDATE SET head_seq = excluded.head_seq, sealed_at = excluded.sealed_at, body = excluded.body
			WHERE excluded.head_seq >= note_seal.head_seq`,
			[seal.headSeq, seal.sealedAt, seal.json],
		);
	}

	async getSeal(_noteId: string): Promise<StoredSeal | null> {
		const [row] = this.db.all<{
			head_seq: number;
			sealed_at: string;
			body: string;
		}>("SELECT head_seq, sealed_at, body FROM note_seal WHERE slot = 1");
		return row
			? { headSeq: row.head_seq, sealedAt: row.sealed_at, json: row.body }
			: null;
	}

	async putContacts(_noteId: string, contacts: Contacts): Promise<void> {
		this.db.transaction(() => {
			for (const role of ["lender", "borrower"] as const) {
				this.db.run(
					"INSERT OR IGNORE INTO note_contacts (role, email) VALUES (?, ?)",
					[role, contacts[role]],
				);
			}
		});
	}

	async getContacts(_noteId: string): Promise<Contacts | null> {
		const rows = this.db.all<{ role: Role; email: string }>(
			"SELECT role, email FROM note_contacts",
		);
		const lender = rows.find((row) => row.role === "lender")?.email;
		const borrower = rows.find((row) => row.role === "borrower")?.email;
		return lender !== undefined && borrower !== undefined
			? { lender, borrower }
			: null;
	}

	async putOrg(_noteId: string, orgId: string): Promise<void> {
		this.db.run("INSERT OR IGNORE INTO note_org (slot, org_id) VALUES (1, ?)", [
			orgId,
		]);
	}

	async getOrg(_noteId: string): Promise<string | null> {
		const [row] = this.db.all<{ org_id: string }>(
			"SELECT org_id FROM note_org WHERE slot = 1",
		);
		return row?.org_id ?? null;
	}

	async putAgent(_noteId: string, agent: AgentRecord): Promise<void> {
		this.db.run(
			`INSERT INTO note_agents (agent_ref, email, role, active, added_at) VALUES (?, ?, ?, ?, ?)
			ON CONFLICT (agent_ref) DO UPDATE SET email = excluded.email, role = excluded.role, active = excluded.active`,
			[
				agent.agentRef,
				agent.email,
				agent.role,
				agent.active ? 1 : 0,
				agent.addedAt,
			],
		);
	}

	async getAgent(
		_noteId: string,
		agentRef: string,
	): Promise<AgentRecord | null> {
		const [row] = this.db.all<AgentRow>(
			`SELECT ${AGENT_COLUMNS} FROM note_agents WHERE agent_ref = ?`,
			[agentRef],
		);
		return row ? agentOf(row) : null;
	}

	async listAgents(_noteId: string): Promise<AgentRecord[]> {
		return this.db
			.all<AgentRow>(
				`SELECT ${AGENT_COLUMNS} FROM note_agents ORDER BY position`,
			)
			.map(agentOf);
	}

	async setAgentActive(
		_noteId: string,
		agentRef: string,
		active: boolean,
	): Promise<boolean> {
		return (
			this.db.run("UPDATE note_agents SET active = ? WHERE agent_ref = ?", [
				active ? 1 : 0,
				agentRef,
			]).changes === 1
		);
	}

	async putInvite(_noteId: string, invite: InviteRecord): Promise<void> {
		this.db.run(
			"INSERT INTO note_invites (hash, role, expires_at, used_at) VALUES (?, ?, ?, NULL)",
			[invite.hash, invite.role, invite.expiresAt],
		);
	}

	async redeemInvite(
		_noteId: string,
		hash: string,
		now: string,
	): Promise<Role | null> {
		return this.db.transaction((): Role | null => {
			const [invite] = this.db.all<{
				role: Role;
				expires_at: string;
				used_at: string | null;
			}>("SELECT role, expires_at, used_at FROM note_invites WHERE hash = ?", [
				hash,
			]);
			if (
				!invite ||
				invite.used_at !== null ||
				instant(now) >= instant(invite.expires_at)
			)
				return null;
			const { changes } = this.db.run(
				"UPDATE note_invites SET used_at = ? WHERE hash = ? AND used_at IS NULL",
				[now, hash],
			);
			return changes === 1 ? invite.role : null;
		});
	}

	async putSession(_noteId: string, session: SessionRecord): Promise<void> {
		this.db.run(
			"INSERT INTO note_sessions (hash, role, created_at, last_seen_at, absolute_expires_at) VALUES (?, ?, ?, ?, ?)",
			[
				session.hash,
				session.role,
				session.createdAt,
				session.lastSeenAt,
				session.absoluteExpiresAt,
			],
		);
	}

	async touchSession(
		_noteId: string,
		hash: string,
		now: string,
		idleMs: number,
	): Promise<SessionRecord | null> {
		return this.db.transaction((): SessionRecord | null => {
			const [row] = this.db.all<{
				role: Role;
				created_at: string;
				last_seen_at: string;
				absolute_expires_at: string;
			}>(
				"SELECT role, created_at, last_seen_at, absolute_expires_at FROM note_sessions WHERE hash = ?",
				[hash],
			);
			if (!row) return null;
			const expired =
				instant(now) >= instant(row.absolute_expires_at) ||
				instant(now) - instant(row.last_seen_at) > idleMs;
			if (expired) {
				this.db.run("DELETE FROM note_sessions WHERE hash = ?", [hash]);
				return null;
			}
			this.db.run("UPDATE note_sessions SET last_seen_at = ? WHERE hash = ?", [
				now,
				hash,
			]);
			return {
				hash,
				role: row.role,
				createdAt: row.created_at,
				lastSeenAt: now,
				absoluteExpiresAt: row.absolute_expires_at,
			};
		});
	}

	async deleteSession(_noteId: string, hash: string): Promise<void> {
		this.db.run("DELETE FROM note_sessions WHERE hash = ?", [hash]);
	}

	async putCode(
		_noteId: string,
		sessionHash: string,
		code: CodeRecord,
	): Promise<void> {
		this.db.run(
			"INSERT OR REPLACE INTO note_codes (session_hash, code_hash, action, expires_at, attempts) VALUES (?, ?, ?, ?, 0)",
			[sessionHash, code.codeHash, code.action, code.expiresAt],
		);
	}

	async takeAttempt(
		_noteId: string,
		sessionHash: string,
		now: string,
		maxAttempts: number,
	): Promise<AttemptResult> {
		return this.db.transaction((): AttemptResult => {
			const [row] = this.db.all<{
				code_hash: string;
				action: string;
				expires_at: string;
				attempts: number;
			}>(
				"SELECT code_hash, action, expires_at, attempts FROM note_codes WHERE session_hash = ?",
				[sessionHash],
			);
			if (!row) return { status: "none" };
			if (instant(now) >= instant(row.expires_at)) {
				this.db.run("DELETE FROM note_codes WHERE session_hash = ?", [
					sessionHash,
				]);
				return { status: "expired" };
			}
			if (row.attempts >= maxAttempts) return { status: "locked" };
			this.db.run(
				"UPDATE note_codes SET attempts = attempts + 1 WHERE session_hash = ?",
				[sessionHash],
			);
			return { status: "ok", codeHash: row.code_hash, action: row.action };
		});
	}

	async clearCode(_noteId: string, sessionHash: string): Promise<boolean> {
		return (
			this.db.run("DELETE FROM note_codes WHERE session_hash = ?", [
				sessionHash,
			]).changes === 1
		);
	}

	async hit(
		_noteId: string,
		key: string,
		now: string,
		windowMs: number,
		limit: number,
	): Promise<boolean> {
		return this.db.transaction((): boolean => {
			const at = instant(now);
			const [row] = this.db.all<{ window_start: number; hits: number }>(
				"SELECT window_start, hits FROM note_counters WHERE counter_key = ?",
				[key],
			);
			if (!row || at - row.window_start >= windowMs) {
				this.db.run(
					"INSERT OR REPLACE INTO note_counters (counter_key, window_start, hits) VALUES (?, ?, 1)",
					[key, at],
				);
				return limit >= 1;
			}
			this.db.run(
				"UPDATE note_counters SET hits = hits + 1 WHERE counter_key = ?",
				[key],
			);
			return row.hits + 1 <= limit;
		});
	}

	async putShare(_noteId: string, share: ShareRecord): Promise<void> {
		this.db.run(
			`INSERT OR IGNORE INTO note_shares (${SHARE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[
				share.grantId,
				share.kind,
				share.audienceRef,
				share.recipientEmail,
				share.linkHash,
				share.linkUsedAt,
				share.createdAt,
			],
		);
	}

	async getShare(
		_noteId: string,
		grantId: string,
	): Promise<ShareRecord | null> {
		const [row] = this.db.all<ShareRow>(
			`SELECT ${SHARE_COLUMNS} FROM note_shares WHERE grant_id = ?`,
			[grantId],
		);
		return row ? shareOf(row) : null;
	}

	async listShares(_noteId: string): Promise<ShareRecord[]> {
		return this.db
			.all<ShareRow>(
				`SELECT ${SHARE_COLUMNS} FROM note_shares ORDER BY position`,
			)
			.map(shareOf);
	}

	async issueShareLink(
		_noteId: string,
		grantId: string,
		hash: string,
		replace: boolean,
	): Promise<boolean> {
		const guard = replace ? "" : " AND link_hash IS NULL";
		return (
			this.db.run(
				`UPDATE note_shares SET link_hash = ?, link_used_at = NULL WHERE grant_id = ?${guard}`,
				[hash, grantId],
			).changes === 1
		);
	}

	async claimShareLink(
		_noteId: string,
		grantId: string,
		hash: string,
		now: string,
	): Promise<boolean> {
		return (
			this.db.run(
				"UPDATE note_shares SET link_used_at = ? WHERE grant_id = ? AND link_hash = ? AND link_used_at IS NULL",
				[now, grantId, hash],
			).changes === 1
		);
	}

	async putShareSession(
		_noteId: string,
		session: ShareSessionRecord,
	): Promise<void> {
		this.db.run(
			"INSERT INTO note_share_sessions (hash, grant_id, created_at, absolute_expires_at) VALUES (?, ?, ?, ?)",
			[
				session.hash,
				session.grantId,
				session.createdAt,
				session.absoluteExpiresAt,
			],
		);
	}

	async getShareSession(
		_noteId: string,
		hash: string,
		now: string,
	): Promise<ShareSessionRecord | null> {
		return this.db.transaction((): ShareSessionRecord | null => {
			const [row] = this.db.all<{
				grant_id: string;
				created_at: string;
				absolute_expires_at: string;
			}>(
				"SELECT grant_id, created_at, absolute_expires_at FROM note_share_sessions WHERE hash = ?",
				[hash],
			);
			if (!row) return null;
			if (instant(now) >= instant(row.absolute_expires_at)) {
				this.db.run("DELETE FROM note_share_sessions WHERE hash = ?", [hash]);
				return null;
			}
			return {
				hash,
				grantId: row.grant_id,
				createdAt: row.created_at,
				absoluteExpiresAt: row.absolute_expires_at,
			};
		});
	}

	async claimIdempotency(
		_noteId: string,
		caller: string,
		key: string,
		fingerprint: string,
	): Promise<IdempotencyResult> {
		return this.db.transaction((): IdempotencyResult => {
			const [row] = this.db.all<{ fingerprint: string }>(
				"SELECT fingerprint FROM note_idempotency WHERE caller = ? AND idem_key = ?",
				[caller, key],
			);
			if (row) return row.fingerprint === fingerprint ? "same" : "different";
			this.db.run(
				"INSERT INTO note_idempotency (caller, idem_key, fingerprint) VALUES (?, ?, ?)",
				[caller, key, fingerprint],
			);
			return "new";
		});
	}
}

/** The store methods a Worker may call on a note's Durable Object. */
export const STORE_METHODS = [
	"readLog",
	"append",
	"putContacts",
	"getContacts",
	"putOrg",
	"getOrg",
	"putAgent",
	"getAgent",
	"listAgents",
	"setAgentActive",
	"putInvite",
	"redeemInvite",
	"putSession",
	"touchSession",
	"deleteSession",
	"putCode",
	"takeAttempt",
	"clearCode",
	"hit",
	"claimIdempotency",
	"putDocumentOnce",
	"getDocument",
	"listDocuments",
	"putSeal",
	"getSeal",
	"putShare",
	"getShare",
	"listShares",
	"issueShareLink",
	"claimShareLink",
	"putShareSession",
	"getShareSession",
] as const satisfies readonly (keyof NoteStore)[];

export type StoreMethod = (typeof STORE_METHODS)[number];

export const isStoreMethod = (value: unknown): value is StoreMethod =>
	STORE_METHODS.some((method) => method === value);

/**
 * The `NoteStore` a Worker uses: each call is one request to that note's Durable Object (`idFromName(noteId)`), which
 * runs it on its `SqliteNoteStore`. The first argument of every method is the note id and is not sent.
 */
export class RemoteNoteStore implements NoteStore {
	constructor(private readonly namespace: DurableObjectNamespace) {}

	private async call<T>(
		method: StoreMethod,
		noteId: string,
		args: unknown[],
	): Promise<T> {
		const stub = this.namespace.get(this.namespace.idFromName(noteId));
		const response = await stub.fetch(
			new Request("https://note.internal/rpc", {
				method: "POST",
				body: JSON.stringify({ method, noteId, args }),
			}),
		);
		if (!response.ok)
			throw new Error(`note store ${method}: ${response.status}`);
		return ((await response.json()) as { result: T }).result;
	}

	readLog(noteId: string) {
		return this.call<{ events: string[]; links: ChainLink[] }>(
			"readLog",
			noteId,
			[],
		);
	}
	append(
		noteId: string,
		expectedSeq: number,
		entry: { eventJson: string; link: ChainLink; document?: StoredDocument },
	) {
		return this.call<AppendResult>("append", noteId, [expectedSeq, entry]);
	}
	putContacts(noteId: string, contacts: Contacts) {
		return this.call<void>("putContacts", noteId, [contacts]);
	}
	getContacts(noteId: string) {
		return this.call<Contacts | null>("getContacts", noteId, []);
	}
	putOrg(noteId: string, orgId: string) {
		return this.call<void>("putOrg", noteId, [orgId]);
	}
	getOrg(noteId: string) {
		return this.call<string | null>("getOrg", noteId, []);
	}
	putAgent(noteId: string, agent: AgentRecord) {
		return this.call<void>("putAgent", noteId, [agent]);
	}
	getAgent(noteId: string, agentRef: string) {
		return this.call<AgentRecord | null>("getAgent", noteId, [agentRef]);
	}
	listAgents(noteId: string) {
		return this.call<AgentRecord[]>("listAgents", noteId, []);
	}
	setAgentActive(noteId: string, agentRef: string, active: boolean) {
		return this.call<boolean>("setAgentActive", noteId, [agentRef, active]);
	}
	putInvite(noteId: string, invite: InviteRecord) {
		return this.call<void>("putInvite", noteId, [invite]);
	}
	redeemInvite(noteId: string, hash: string, now: string) {
		return this.call<Role | null>("redeemInvite", noteId, [hash, now]);
	}
	putSession(noteId: string, session: SessionRecord) {
		return this.call<void>("putSession", noteId, [session]);
	}
	touchSession(noteId: string, hash: string, now: string, idleMs: number) {
		return this.call<SessionRecord | null>("touchSession", noteId, [
			hash,
			now,
			idleMs,
		]);
	}
	deleteSession(noteId: string, hash: string) {
		return this.call<void>("deleteSession", noteId, [hash]);
	}
	putCode(noteId: string, sessionHash: string, code: CodeRecord) {
		return this.call<void>("putCode", noteId, [sessionHash, code]);
	}
	takeAttempt(
		noteId: string,
		sessionHash: string,
		now: string,
		maxAttempts: number,
	) {
		return this.call<AttemptResult>("takeAttempt", noteId, [
			sessionHash,
			now,
			maxAttempts,
		]);
	}
	clearCode(noteId: string, sessionHash: string) {
		return this.call<boolean>("clearCode", noteId, [sessionHash]);
	}
	hit(
		noteId: string,
		key: string,
		now: string,
		windowMs: number,
		limit: number,
	) {
		return this.call<boolean>("hit", noteId, [key, now, windowMs, limit]);
	}
	claimIdempotency(
		noteId: string,
		caller: string,
		key: string,
		fingerprint: string,
	) {
		return this.call<IdempotencyResult>("claimIdempotency", noteId, [
			caller,
			key,
			fingerprint,
		]);
	}
	putDocumentOnce(noteId: string, document: StoredDocument) {
		return this.call<StoredDocument>("putDocumentOnce", noteId, [document]);
	}
	getDocument(noteId: string, docId: string) {
		return this.call<StoredDocument | null>("getDocument", noteId, [docId]);
	}
	listDocuments(noteId: string) {
		return this.call<StoredDocument[]>("listDocuments", noteId, []);
	}
	putSeal(noteId: string, seal: StoredSeal) {
		return this.call<void>("putSeal", noteId, [seal]);
	}
	getSeal(noteId: string) {
		return this.call<StoredSeal | null>("getSeal", noteId, []);
	}
	putShare(noteId: string, share: ShareRecord) {
		return this.call<void>("putShare", noteId, [share]);
	}
	getShare(noteId: string, grantId: string) {
		return this.call<ShareRecord | null>("getShare", noteId, [grantId]);
	}
	listShares(noteId: string) {
		return this.call<ShareRecord[]>("listShares", noteId, []);
	}
	issueShareLink(
		noteId: string,
		grantId: string,
		hash: string,
		replace: boolean,
	) {
		return this.call<boolean>("issueShareLink", noteId, [
			grantId,
			hash,
			replace,
		]);
	}
	claimShareLink(noteId: string, grantId: string, hash: string, now: string) {
		return this.call<boolean>("claimShareLink", noteId, [grantId, hash, now]);
	}
	putShareSession(noteId: string, session: ShareSessionRecord) {
		return this.call<void>("putShareSession", noteId, [session]);
	}
	getShareSession(noteId: string, hash: string, now: string) {
		return this.call<ShareSessionRecord | null>("getShareSession", noteId, [
			hash,
			now,
		]);
	}
}
