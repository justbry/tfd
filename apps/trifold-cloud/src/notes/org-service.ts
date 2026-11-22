import {
	type ApprovalAction,
	portfolio as buildPortfolio,
	isValidCivilDate,
	type NoteEvent,
	type Portfolio,
	type PortfolioNote,
	pendingApprovals,
	validateStream,
	verifyChain,
} from "tfd-notes";
import { isPlausibleEmail, normalizeEmail } from "./masking";
import {
	type AgentRole,
	emailHash,
	isAgentRole,
	MAX_AGENTS_PER_REQUEST,
	ORG_POLICY,
} from "./org";
import { type OrgSession, OrgSessionManager } from "./org-sessions";
import type { OrgStore } from "./org-store";
import { type Failure, failure, type Outcome } from "./outcome";
import type { Clock, IdSource, MailSender } from "./ports";
import { type ActiveSession, constantTimeEqual, hashPrefix } from "./sessions";
import type { NoteStore } from "./store";

/**
 * The organization side of the notes service (build step 4): who an organization's agents are, how they sign in, what
 * each may do on a note, and the portfolio across the organization's notes. Port-based like `NoteService`.
 */

const HOUR_MS = 3_600_000;
const DATE_LENGTH = 10;
export const ORG_LINK_REQUESTS_PER_ORG = 20;
export const ORG_LINK_REQUESTS_PER_ADDRESS = 3;
export const ORG_LINK_WINDOW_MS = HOUR_MS;
/** The most notes one portfolio reads. More than this needs paging, which is not built. */
export const MAX_PORTFOLIO_NOTES = 500;
/** The most agents one organization may have registered on one note. */
export const MAX_AGENTS_PER_NOTE = 50;
const PORTFOLIO_BATCH = 10;
const AGENT_REF_BYTES = 12;

export interface OrgServiceDeps {
	orgs: OrgStore;
	store: NoteStore;
	mailer: MailSender;
	clock: Clock;
	ids: IdSource;
	/** `NOTES_SESSION_SECRET`: salts the address hashes and keys the CSRF tokens. */
	secret: string;
	/** `https://<ledger host>`, no trailing slash: where emailed links point. */
	baseUrl: string;
}

/** An agent as a caller states it: a plain address and a role name. */
export interface AgentInput {
	email: string;
	role: string;
}

export interface RegisteredAgent {
	agentRef: string;
	email: string;
	role: AgentRole;
}

/** One approval request still waiting for a board member, across the organization's notes. */
export interface QueueItem {
	noteId: string;
	requestId: string;
	action: ApprovalAction;
	requestedAt: string;
	/** Internal: whose request it is, so a page can hide Approve on the agent's own. Never rendered or returned by the API. */
	requestedByRef: string | null;
}

export interface OrgPortfolio {
	portfolio: Portfolio;
	queue: QueueItem[];
}

/** Validates a list of agents: plain addresses, known roles, no address twice. Returns them normalized, or the failure. */
export const parseAgents = (
	input: unknown,
): { agents: { email: string; role: AgentRole }[] } | Failure => {
	if (
		!Array.isArray(input) ||
		input.length === 0 ||
		input.length > MAX_AGENTS_PER_REQUEST
	)
		return failure(
			"bad_request",
			`Name 1 to ${MAX_AGENTS_PER_REQUEST} agents, each with an email and a role.`,
		);
	const agents: { email: string; role: AgentRole }[] = [];
	for (const entry of input as unknown[]) {
		const { email, role } = (entry ?? {}) as Record<string, unknown>;
		if (typeof email !== "string" || !isAgentRole(role))
			return failure(
				"bad_request",
				"Each agent needs an email and a role: treasurer, board or viewer.",
			);
		const address = normalizeEmail(email);
		if (!isPlausibleEmail(address))
			return failure("bad_request", "Each agent needs a valid email address.");
		if (agents.some((agent) => agent.email === address))
			return failure(
				"bad_request",
				"An email address can be listed only once.",
			);
		agents.push({ email: address, role });
	}
	return { agents };
};

const sentence = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

export class OrgService {
	readonly sessions: OrgSessionManager;

	constructor(private readonly deps: OrgServiceDeps) {
		this.sessions = new OrgSessionManager({
			orgs: deps.orgs,
			clock: deps.clock,
			ids: deps.ids,
			secret: deps.secret,
		});
	}

	/** True when the organization has at least one note: an organization nobody registered does not exist here. */
	async exists(orgId: string): Promise<boolean> {
		return (await this.deps.orgs.listNotes(orgId, 1)).length > 0;
	}

	/**
	 * Registers a note in the organization's index and its agents on the note, the organization-wide agent rows first.
	 * Every write is idempotent, so a retried create finds the same agents with the same refs. An address already known to
	 * the organization keeps its ref (and gets the role stated here, active again).
	 */
	async registerNote(
		noteId: string,
		orgId: string,
		agents: readonly { email: string; role: AgentRole }[],
	): Promise<RegisteredAgent[]> {
		const { orgs, store, ids, clock, secret } = this.deps;
		const now = clock.now();
		const registered: RegisteredAgent[] = [];
		await store.putOrg(noteId, orgId);
		for (const agent of agents) {
			const record = await orgs.upsertAgent(orgId, {
				newRef: `ag_${ids.token(AGENT_REF_BYTES)}`,
				emailHash: await emailHash(secret, orgId, agent.email),
				role: agent.role,
				now,
			});
			await store.putAgent(noteId, {
				agentRef: record.agentRef,
				email: agent.email,
				role: record.role,
				active: true,
				addedAt: now,
			});
			registered.push({
				agentRef: record.agentRef,
				email: agent.email,
				role: record.role,
			});
		}
		await orgs.registerNote(orgId, noteId, "lender", now);
		return registered;
	}

	/** Emails one agent a single-use link. The text names no borrower and no other agent. */
	async inviteAgent(
		orgId: string,
		agent: RegisteredAgent,
		noteId?: string,
	): Promise<void> {
		const token = await this.sessions.issueLink(orgId, agent.agentRef);
		const note = noteId === undefined ? "" : `&n=${noteId}`;
		await this.deps.mailer.send({
			to: agent.email,
			subject: "A loan record is waiting for your team",
			text: [
				`Your organization started a loan record as the lender, and you are on its team as a ${agent.role}.`,
				"",
				"Open it here. The link works once, for seven days:",
				`${this.deps.baseUrl}/o/${orgId}/enter?t=${token}${note}`,
				"",
				"If you did not expect this, ignore this email: nothing happens until the link is used.",
				"A record, not legal or tax advice.",
			].join("\n"),
		});
	}

	/**
	 * A fresh link for the agent whose address matches, sent to the address given. The caller always shows the same
	 * answer, whether or not an address matched or a limit was hit. Limits: per organization and per address (counted by a
	 * hash of the address, never the address).
	 */
	async requestLink(orgId: string, email: string): Promise<void> {
		const { orgs, clock, secret } = this.deps;
		const address = normalizeEmail(email);
		const now = clock.now();
		const orgAllowed = await orgs.hit(
			orgId,
			"link:org",
			now,
			ORG_LINK_WINDOW_MS,
			ORG_LINK_REQUESTS_PER_ORG,
		);
		const addressAllowed = await orgs.hit(
			orgId,
			`link:address:${await hashPrefix(address)}`,
			now,
			ORG_LINK_WINDOW_MS,
			ORG_LINK_REQUESTS_PER_ADDRESS,
		);
		if (!(orgAllowed && addressAllowed) || !isPlausibleEmail(address)) return;
		const known = await orgs.findAgent(
			orgId,
			await emailHash(secret, orgId, address),
		);
		if (known === null || !known.active) return;
		try {
			await this.inviteAgent(orgId, {
				agentRef: known.agentRef,
				email: address,
				role: known.role,
			});
		} catch (error) {
			console.error(
				`notes: org link email failed: ${error instanceof Error ? error.name : "error"}`,
			);
		}
	}

	/**
	 * What this agent may do on this note now: their role, or null when the note is not this organization's lender side,
	 * or the agent is unknown or inactive in the organization or on the note. The role is read live.
	 */
	async roleOnNote(
		orgId: string,
		noteId: string,
		agentRef: string,
	): Promise<AgentRole | null> {
		const { orgs, store } = this.deps;
		if ((await store.getOrg(noteId)) !== orgId) return null;
		const agent = await orgs.getAgent(orgId, agentRef);
		if (!agent?.active) return null;
		const record = await store.getAgent(noteId, agentRef);
		return record?.active ? agent.role : null;
	}

	/** The note session of a signed-in agent, or null when the note is not theirs to open. */
	async noteSession(
		session: OrgSession,
		noteId: string,
	): Promise<ActiveSession | null> {
		const role = await this.roleOnNote(session.orgId, noteId, session.agentRef);
		if (role === null) return null;
		return {
			noteId,
			role: "lender",
			hash: session.hash,
			agent: { orgId: session.orgId, agentRef: session.agentRef, role },
		};
	}

	/**
	 * Adds an agent to a note's organization (or brings a deactivated one back, with the role stated) and emails them a
	 * link. Nothing here names the borrower: the borrower's address is only compared, never sent or returned.
	 */
	async addAgent(
		noteId: string,
		input: AgentInput,
	): Promise<Outcome<{ agentRef: string; role: AgentRole }>> {
		const { store } = this.deps;
		const orgId = await store.getOrg(noteId);
		if (orgId === null)
			return failure("not_found", "No such organization note.");
		const parsed = parseAgents([input]);
		if ("ok" in parsed) return parsed;
		const [agent] = parsed.agents as [{ email: string; role: AgentRole }];
		const contacts = await store.getContacts(noteId);
		if (contacts !== null && constantTimeEqual(agent.email, contacts.borrower))
			return failure(
				"same_party",
				"The borrower cannot be on the lender's team.",
			);
		if ((await store.listAgents(noteId)).length >= MAX_AGENTS_PER_NOTE)
			return failure("bad_request", "This note has the most agents allowed.");
		const [registered] = await this.registerNote(noteId, orgId, [agent]);
		const added = registered as RegisteredAgent;
		try {
			await this.inviteAgent(orgId, added, noteId);
		} catch {
			return failure(
				"mail_failed",
				"The agent was added but the link could not be sent; they can ask for a new one.",
			);
		}
		return { ok: true, agentRef: added.agentRef, role: added.role };
	}

	/**
	 * Deactivates an agent of the note's organization, named by ref or by address. The organization-wide flag goes first,
	 * so access stops at once; then their sessions and pending links go, and the agent is switched off on every note of
	 * the organization. History keeps the `agent_ref` on what they entered.
	 */
	async deactivateAgent(
		noteId: string,
		who: { agentRef?: string; email?: string },
	): Promise<Outcome<{ agentRef: string }>> {
		const { orgs, store, secret } = this.deps;
		const orgId = await store.getOrg(noteId);
		if (orgId === null)
			return failure("not_found", "No such organization note.");
		let agentRef: string | null = null;
		if (who.agentRef !== undefined) {
			agentRef = (await store.getAgent(noteId, who.agentRef))?.agentRef ?? null;
		} else if (who.email !== undefined) {
			const found = await orgs.findAgent(
				orgId,
				await emailHash(secret, orgId, normalizeEmail(who.email)),
			);
			agentRef = found?.agentRef ?? null;
		}
		if (agentRef === null) return failure("not_found", "No such agent.");
		await orgs.setAgentActive(orgId, agentRef, false);
		await this.sessions.revokeAgent(orgId, agentRef);
		for (const id of await orgs.listNotes(orgId, MAX_PORTFOLIO_NOTES)) {
			await store.setAgentActive(id, agentRef, false);
		}
		return { ok: true, agentRef };
	}

	private asOfToday(): string {
		return this.deps.clock.now().slice(0, DATE_LENGTH);
	}

	private async loadNote(
		orgId: string,
		noteId: string,
	): Promise<
		| { note: PortfolioNote; events: NoteEvent[] }
		| { invalid: { note_id: string; error: string } }
	> {
		const { store } = this.deps;
		try {
			if ((await store.getOrg(noteId)) !== orgId)
				return {
					invalid: {
						note_id: noteId,
						error: "the note is not registered to this organization",
					},
				};
			const log = await store.readLog(noteId);
			const raw = log.events.map((text): unknown => JSON.parse(text));
			const events = validateStream(raw);
			const verdict = await verifyChain(events, log.links, noteId);
			if (!verdict.ok)
				return {
					invalid: {
						note_id: noteId,
						error: `record check failed (${verdict.reason})`,
					},
				};
			return { note: { note_id: noteId, role: "lender", events: raw }, events };
		} catch (error) {
			return { invalid: { note_id: noteId, error: sentence(error) } };
		}
	}

	/**
	 * The portfolio of every note in the organization's index, through the organization's role (lender), as of `asOf`
	 * (default today), and the approvals queue across them. A note that does not validate or does not match its chain is
	 * listed as invalid and never stops the rest.
	 */
	async portfolio(
		orgId: string,
		asOf?: string,
	): Promise<Outcome<OrgPortfolio & { asOf: string }>> {
		if (asOf !== undefined && !isValidCivilDate(asOf))
			return failure("bad_request", "as_of must be a date, YYYY-MM-DD.");
		const date = asOf ?? this.asOfToday();
		const noteIds = await this.deps.orgs.listNotes(
			orgId,
			MAX_PORTFOLIO_NOTES + 1,
		);
		if (noteIds.length > MAX_PORTFOLIO_NOTES)
			return failure(
				"bad_request",
				`This organization has more than ${MAX_PORTFOLIO_NOTES} notes; the portfolio needs paging, which is not built yet.`,
			);
		const notes: PortfolioNote[] = [];
		const invalid: { note_id: string; error: string }[] = [];
		const queue: QueueItem[] = [];
		for (let start = 0; start < noteIds.length; start += PORTFOLIO_BATCH) {
			const loaded = await Promise.all(
				noteIds
					.slice(start, start + PORTFOLIO_BATCH)
					.map((noteId) => this.loadNote(orgId, noteId)),
			);
			for (const entry of loaded) {
				if ("invalid" in entry) {
					invalid.push(entry.invalid);
					continue;
				}
				notes.push(entry.note);
				queue.push(...queueOf(entry.note.note_id, entry.events));
			}
		}
		const computed = buildPortfolio(notes, date);
		const rowIds = new Set(computed.rows.map((row) => row.note_id));
		return {
			ok: true,
			asOf: date,
			portfolio: { ...computed, invalid: [...computed.invalid, ...invalid] },
			queue: queue.filter((item) => rowIds.has(item.noteId)),
		};
	}
}

/** The approval requests of one note that still wait for a board member, oldest first. */
const queueOf = (noteId: string, events: readonly NoteEvent[]): QueueItem[] => {
	const items: QueueItem[] = [];
	for (const pending of pendingApprovals(events, ORG_POLICY)) {
		const request = events.find(
			(event) =>
				event.type === "approval.requested" &&
				event.action === pending.action &&
				event.target === pending.target &&
				event.entered_at === pending.requested_at &&
				(event.agent_ref ?? null) === pending.requested_by_agent,
		);
		if (request === undefined) continue;
		items.push({
			noteId,
			requestId: request.id,
			action: pending.action,
			requestedAt: pending.requested_at,
			requestedByRef: pending.requested_by_agent,
		});
	}
	return items;
};
