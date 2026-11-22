import {
	type ApprovalAction,
	type ApprovalAgents,
	type ApprovalPolicy,
	addDays,
	approvalStatus,
	buildChain,
	type ChainLink,
	type ChainVerdict,
	canonicalJson,
	chainHead,
	chainSealBody,
	checkAppend,
	documentSha256,
	extendChain,
	type Grant,
	type GrantPurpose,
	type GrantStatus,
	grantsOf,
	isValidCivilDate,
	NOTE_EVENT_SCHEMA,
	type NoteDocumentBody,
	type NoteEvent,
	type NoteTerms,
	paymentReceiptBody,
	payoffStatementBody,
	pendingApprovals,
	type Role,
	releaseBody,
	type Statement,
	sha256Hex,
	signDocument,
	statement,
	validateStream,
	verifyChain,
} from "tfd-notes";
import { type OrgNoteView, orgViewOf } from "./approvals-view";
import {
	DEFAULT_RELEASE_COOLING_MS,
	type DocumentSigners,
	MAX_CURE_DAYS,
	NOTICE_WINDOW_MS,
	NOTICES_PER_DAY,
	noticeEmail,
	PAYOFF_WINDOW_MS,
	PAYOFFS_PER_HOUR,
	type ReleaseSummary,
	releaseSummary,
} from "./documents-service";
import { isPlausibleEmail, maskEmail, normalizeEmail } from "./masking";
import { isValidNoteId, noteIdFor } from "./note-ids";
import {
	type AgentIdentity,
	type AgentRole,
	NO_APPROVALS,
	ORG_ID_PATTERN,
	orgNotePath,
	orgPolicyFor,
} from "./org";
import {
	type OrgService,
	parseAgents,
	type RegisteredAgent,
} from "./org-service";
import { type Failure, failure, type Outcome } from "./outcome";
import {
	type Clock,
	type Defer,
	type IdSource,
	type MailSender,
	unawaited,
} from "./ports";
import {
	type ActiveSession,
	basePathOf,
	constantTimeEqual,
	hashPrefix,
	hmac,
	SessionManager,
	type SessionOptions,
} from "./sessions";
import {
	disclosureEmail,
	expiryAfter,
	isProposer,
	linkRefOf,
	parseDays,
	parseProposal,
	personRefOf,
	SHARE_RESENDS_PER_DAY,
	SHARE_WINDOW_MS,
	SHARES_PER_DAY,
	type SharingView,
	shareEmail,
	sharingViewOf,
	verifyTokenOf,
} from "./share-core";
import type { NoteStore, StoredDocument, StoredSeal } from "./store";

/**
 * The guest flow's logic (docs/specs/promissory-notes.md build step 2; plan D2, D5). Pure and port-based: a store, a
 * mailer, a clock and an id source go in, so it runs the same in tests and in a Durable Object.
 */

export type { ErrorCode, Failure, Outcome } from "./outcome";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
/** Link requests one client address (hashed) may make for one note in a window. */
export const LINK_REQUESTS_PER_CLIENT = 10;
/** Link requests one email address (hashed) may make for one note in a window. */
export const LINK_REQUESTS_PER_ADDRESS = 3;
export const LINK_WINDOW_MS = HOUR_MS;
const MAX_TEXT_LENGTH = 2000;
const MAX_IDEM_LENGTH = 200;
const DATE_LENGTH = 10;
const MINUTE_LENGTH = 16;
const SEQ_START = 0;
const MAX_APPEND_ATTEMPTS = 2;
/** The caller recorded on an idempotency record: there is one API key today. */
export const API_CALLER = "api";

export { isValidNoteId, noteIdFor };

type EventRule = {
	roles: readonly Role[];
	stepUp: boolean;
	fields: readonly string[];
};

/**
 * What a guest session may enter. This is the whole permission table: an event type not listed is `forbidden_event`
 * (the lender-only and organization events arrive in later slices), a listed type from the wrong role is `wrong_role`.
 * `stepUp` events need a fresh emailed 6-digit code (plan D2). `fields` is what the client may send besides `type`;
 * everything else on the event is set by the server.
 */
export const EVENT_RULES: Readonly<Record<string, EventRule>> = {
	"terms.accepted": { roles: ["borrower"], stepUp: true, fields: [] },
	"terms.declined": { roles: ["borrower"], stepUp: false, fields: [] },
	"payment.recorded": {
		roles: ["lender", "borrower"],
		stepUp: false,
		fields: [
			"kind",
			"amount_minor",
			"value_date",
			"method",
			"reference",
			"reverses",
			"source",
		],
	},
	"payment.confirmed": {
		roles: ["lender", "borrower"],
		stepUp: false,
		fields: ["target"],
	},
	"payment.disputed": {
		roles: ["lender", "borrower"],
		stepUp: true,
		fields: ["target", "counter_amount_minor", "reason"],
	},
	"payment.resolved": {
		roles: ["lender", "borrower"],
		stepUp: true,
		fields: ["target", "agreed_amount_minor"],
	},
	// Annotations are visible to both parties in v1. There is no private-note flag: do not add one without a plan.
	"annotation.added": {
		roles: ["lender", "borrower"],
		stepUp: false,
		fields: ["text", "attachment_sha256", "target"],
	},
};

/**
 * What only the lender may do, and only through its own service method (the server fixes every field of these
 * events, so the generic `append` refuses all four with `forbidden_event`). `stepUp` needs the emailed code: a release
 * confirmation always, a notice only when its kind is `default` (`sendNotice` skips the code for a reminder).
 */
export const LENDER_ACTIONS: Readonly<
	Record<string, { roles: readonly Role[]; stepUp: boolean }>
> = {
	"payoff.issued": { roles: ["lender"], stepUp: false },
	"release.drafted": { roles: ["lender"], stepUp: false },
	"release.confirmed": { roles: ["lender"], stepUp: true },
	"notice.sent": { roles: ["lender"], stepUp: true },
};

/** Every action a step-up code may be requested for: the guest events that need one and the lender's two. */
export const STEP_UP_ACTIONS: ReadonlySet<string> = new Set([
	...Object.entries(EVENT_RULES)
		.filter(([, rule]) => rule.stepUp)
		.map(([type]) => type),
	...Object.entries(LENDER_ACTIONS)
		.filter(([, rule]) => rule.stepUp)
		.map(([type]) => type),
]);

/**
 * Consenting to a share also needs the emailed code (build step 5). Its event type, `visibility.changed`, is shared with
 * proposing and revoking, which need none, so the code is bound to this action name instead of the event type.
 */
export const SHARE_CONSENT_ACTION = "grant.consented";

/** True for every action a step-up code may be requested for. */
export const isStepUpAction = (action: string): boolean =>
	STEP_UP_ACTIONS.has(action) || action === SHARE_CONSENT_ACTION;

/** Fields only the server sets. A client that sends one is refused, so it can never choose them. */
const SERVER_FIELDS = [
	"schema",
	"id",
	"note_id",
	"seq",
	"entered_at",
	"entered_by",
	"via",
	"agent_ref",
] as const;

export interface NeedsYou {
	kind: "accept_terms" | "answer_payment" | "answer_dispute";
	/** The payment event the item is about; absent for `accept_terms`. */
	eventId?: string;
}

export interface NoteView {
	noteId: string;
	/** The path of this note's page for this session: `/n/:id` for a guest, `/o/:orgId/n/:id` for an agent. */
	basePath: string;
	role: Role;
	/** The lender is an organization: pages say "the lender's team" and show no agent's address or ref. */
	lenderIsOrg: boolean;
	/** Set for an organization agent: their role, the approval requests and what they may do next. */
	org: OrgNoteView | null;
	asOf: string;
	terms: NoteTerms;
	statement: Statement;
	chain: ChainVerdict;
	state: Statement["state"];
	/** The log in `seq` order. It holds no personal data: parties are roles, never names or emails. */
	events: NoteEvent[];
	/** Each party's address with most characters hidden (`maskEmail`). */
	masked: Record<Role, string>;
	needsYou: NeedsYou[];
	/** The signed documents of this note, oldest first. */
	documents: ViewDocument[];
	release: ReleaseSummary;
	/** The shares of this note as both parties read them, and the disclosure log. */
	sharing: SharingView;
}

export interface ViewDocument {
	id: string;
	type: NoteDocumentBody["type"];
	eventId: string | null;
	createdAt: string;
}

/** What `bundle` returns: everything an offline verifier needs but the public keys. */
export interface NoteBundleFile {
	events: unknown[];
	links: ChainLink[];
	/** Receipts, payoff statements and releases, oldest first. */
	documents: unknown[];
	/** The latest chain seal, or null when none was ever signed. */
	seal: unknown;
}

const otherRole = (role: Role): Role =>
	role === "lender" ? "borrower" : "lender";

/** Items waiting for `role` to answer: the terms, a payment the other side recorded, a dispute that needs a reply. */
export const awaitingRole = (
	events: readonly NoteEvent[],
	current: Statement,
	role: Role,
): NeedsYou[] => {
	const items: NeedsYou[] = [];
	if (role === "borrower" && current.state.terms === "proposed")
		items.push({ kind: "accept_terms" });
	for (const item of current.difference) {
		if (item.status === "claimed-by-lender" && role === "borrower")
			items.push({ kind: "answer_payment", eventId: item.event_id });
		if (item.status === "claimed-by-borrower" && role === "lender")
			items.push({ kind: "answer_payment", eventId: item.event_id });
		if (item.status === "disputed" && disputeNeeds(events, item.event_id, role))
			items.push({ kind: "answer_dispute", eventId: item.event_id });
	}
	return items;
};

/** A dispute needs `role` when the other party opened it, or the other party has filed a resolution `role` has not. */
const disputeNeeds = (
	events: readonly NoteEvent[],
	target: string,
	role: Role,
): boolean => {
	let lastDispute: NoteEvent | undefined;
	for (const event of events) {
		if (event.type === "payment.disputed" && event.target === target)
			lastDispute = event;
	}
	if (lastDispute === undefined) return false;
	const filed = new Set<Role>();
	for (const event of events) {
		if (
			event.type === "payment.resolved" &&
			event.target === target &&
			event.seq > lastDispute.seq
		)
			filed.add(event.entered_by);
	}
	if (filed.has(role)) return false;
	return lastDispute.entered_by !== role || filed.has(otherRole(role));
};

const sentence = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/** A readable one-line reason from the validator, without its `events[n]:` position prefix. */
const validatorReason = (error: unknown): string =>
	sentence(error).replace(/^events\[\d+\]: /, "");

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** NFC text without lone surrogates and within the length limit, or null (the chain refuses anything else). */
const cleanText = (value: string): string | null => {
	const text = value.normalize("NFC");
	if (text.length > MAX_TEXT_LENGTH) return null;
	try {
		encodeURIComponent(text);
	} catch {
		return null;
	}
	return text;
};

export interface NoteServiceDeps {
	store: NoteStore;
	mailer: MailSender;
	clock: Clock;
	ids: IdSource;
	/** `NOTES_SESSION_SECRET`. */
	secret: string;
	/** `https://<ledger host>`, no trailing slash: where emailed links point. */
	baseUrl: string;
	sessionOptions?: SessionOptions;
	/** Who signs documents. Absent or null: every document method answers `not_configured`. */
	signers?: DocumentSigners | null;
	/** The organization side. Absent: a note with an organization lender cannot be created. */
	org?: OrgService | null;
	/** Runs work after the response is sent (`ctx.waitUntil`). Absent: the work starts and nobody waits for it. */
	defer?: Defer;
	options?: {
		/** How long after a release is drafted the lender may confirm it. Default 24 hours. */
		releaseCoolingMs?: number;
	};
}

/** The lender as a caller states it: a person's address, or an organization and the agents it registers. */
export type LenderInput =
	| { email: string }
	| { org_id: string; agents: unknown };

export interface AgentSummary {
	agentRef: string;
	role: AgentRole;
	active: boolean;
}

const MAX_PAYOFF_DAYS_AHEAD = 366;
/** 256 bits, for a share link's token. */
const SHARE_TOKEN_BYTES = 32;

type Loaded = {
	raw: unknown[];
	links: ChainLink[];
	events: NoteEvent[];
};

const APPROVAL_ACTIONS: readonly ApprovalAction[] = [
	"release.confirm",
	"notice.default",
	"waiver",
];

const isApprovalAction = (value: unknown): value is ApprovalAction =>
	APPROVAL_ACTIONS.some((action) => action === value);

/**
 * Recorded beside an approved waiver. The engine has no event that forgives money, so this says only that two people
 * approved the request and that no balance moved.
 */
const WAIVER_ANNOTATION =
	"The lender's team recorded a two-person approval for a waiver. This record changes no balance.";

/** The `agent_ref` the server stamps on an event an organization agent enters; nothing for a guest. */
const agentStamp = (session: ActiveSession): { agent_ref?: string } =>
	session.agent ? { agent_ref: session.agent.agentRef } : {};

const REJECTED_DECLINED =
	"The borrower said this is not their loan. Payments and notes can still be recorded; payoff statements and notices are paused.";

/**
 * The failure for a release confirmation `checkAppend` refused. Without its approval it is `approval_required` and says
 * what is missing; any other refusal (an agent approving their own request, say) is `rejected`. The release is the only
 * step that comes here: a default notice picks its own approval first (`pickNoticeApproval`).
 */
const approvalFailure = (
	type: string,
	earlier: readonly NoteEvent[],
	candidate: Record<string, unknown>,
	error: unknown,
	agents: ApprovalAgents,
): Failure => {
	if (type !== "release.confirmed")
		return failure("rejected", validatorReason(error));
	const requested = approvalStatus(
		earlier,
		{
			action: "release.confirm",
			target: typeof candidate.target === "string" ? candidate.target : "",
		},
		agents,
	).requested;
	return requested
		? failure(
				"approval_required",
				"The release is waiting for approval: a board member other than the person who asked must approve it first.",
				{ missing: "approval" },
			)
		: failure(
				"approval_required",
				"A release needs two people. Ask for approval first; a board member other than you must then approve it.",
				{ missing: "request" },
			);
};

/**
 * The approval request a default notice for `cureDays` will use: the oldest request for `notice.default` with those cure
 * days that has an approver (an agent still on the team) and that no notice has used yet. When there is none, the
 * failure says whether to ask for one or to wait for a board member.
 */
const pickNoticeApproval = (
	events: readonly NoteEvent[],
	cureDays: number,
	agents: ApprovalAgents,
): { requestId: string } | Failure => {
	const used = new Set<string>();
	for (const event of events) {
		if (event.type === "notice.sent" && event.approval !== undefined)
			used.add(event.approval);
	}
	let waiting = false;
	for (const event of events) {
		if (
			event.type !== "approval.requested" ||
			event.action !== "notice.default" ||
			event.cure_days !== cureDays ||
			used.has(event.id)
		)
			continue;
		const status = approvalStatus(
			events,
			{ action: event.action, target: event.target },
			agents,
		);
		if (status.satisfied) return { requestId: event.id };
		waiting = true;
	}
	return waiting
		? failure(
				"approval_required",
				`The default notice for ${cureDays} days to cure is waiting for approval: a board member other than the person who asked must approve it first.`,
				{ missing: "approval" },
			)
		: failure(
				"approval_required",
				`A default notice needs two people. Ask for approval for ${cureDays} days to cure first; a board member other than you must then approve it.`,
				{ missing: "request" },
			);
};

export class NoteService {
	readonly sessions: SessionManager;
	private readonly releaseCoolingMs: number;

	constructor(private readonly deps: NoteServiceDeps) {
		this.releaseCoolingMs =
			deps.options?.releaseCoolingMs ?? DEFAULT_RELEASE_COOLING_MS;
		this.sessions = new SessionManager(
			{
				store: deps.store,
				clock: deps.clock,
				ids: deps.ids,
				secret: deps.secret,
			},
			deps.sessionOptions,
		);
	}

	/**
	 * What needs two people for this session: for an organization agent the org policy, counting only the agents on the
	 * team now (a request or an approval by someone who has left counts for nothing); for a guest, nothing.
	 */
	private async policyOf(session: ActiveSession): Promise<ApprovalPolicy> {
		const { agent } = session;
		if (agent === undefined) return NO_APPROVALS;
		return orgPolicyFor(
			this.deps.org
				? await this.deps.org.activeAgentRefs(agent.orgId, session.noteId)
				: new Set(),
		);
	}

	private async loadLog(
		noteId: string,
	): Promise<{ raw: unknown[]; links: ChainLink[] }> {
		const { events, links } = await this.deps.store.readLog(noteId);
		return { raw: events.map((text): unknown => JSON.parse(text)), links };
	}

	private async sendInvite(
		noteId: string,
		role: Role,
		email: string,
		options: { replace?: boolean } = {},
	): Promise<void> {
		const token = await this.sessions.issueInvite(noteId, role, options);
		await this.deps.mailer.send({
			to: email,
			subject: "A loan record is waiting for you",
			text: [
				`A loan record was started and you are named as the ${role}.`,
				"",
				"Open it here. The link works once, for seven days:",
				`${this.deps.baseUrl}/n/${noteId}/enter?t=${token}`,
				"",
				"If you did not expect this, ignore this email: nothing happens until the link is used.",
				"A record, not legal or tax advice.",
			].join("\n"),
		});
	}

	/**
	 * Starts a note: validates `note.created` with the engine, writes event 1 and its chain link, and emails each party
	 * their own single-use link. `idem` makes it safe to retry: the same `(caller, idem, request)` answers the same note
	 * and sends nothing again; the same `idem` with a different request is `idempotency_conflict`. The server sets id,
	 * seq and `entered_at`; `entered_by` is `lender` (the lender's side starts every note).
	 *
	 * The lender is a person (`{ email }`) or an organization (`{ org_id, agents }`): then each agent gets their own link
	 * and the two-person policy applies. The organization's registration is written before event 1, every write is
	 * idempotent, so a retry after a crash finishes the job.
	 */
	async createNote(input: {
		terms: unknown;
		lender: LenderInput;
		borrower: { email: string };
		idem: string;
		caller?: string;
	}): Promise<
		Outcome<{ noteId: string; created: boolean; agents?: AgentSummary[] }>
	> {
		const borrower = normalizeEmail(input.borrower.email);
		const side = this.parseLender(input.lender, borrower);
		if ("ok" in side) return side;
		const { idem } = input;
		if (
			typeof idem !== "string" ||
			idem === "" ||
			idem.length > MAX_IDEM_LENGTH
		)
			return failure(
				"bad_request",
				"Send an idempotency key of 1 to 200 characters.",
			);
		const caller = input.caller ?? API_CALLER;
		const noteId = await noteIdFor(this.deps.secret, caller, idem);
		let fingerprint: string;
		try {
			fingerprint = await sha256Hex(
				canonicalJson({
					terms: input.terms,
					lender:
						side.kind === "person"
							? side.email
							: {
									org_id: side.orgId,
									agents: [...side.agents].sort((left, right) =>
										left.email < right.email ? -1 : 1,
									),
								},
					borrower,
				}),
			);
		} catch (error) {
			return failure("invalid_terms", sentence(error));
		}
		const created: Record<string, unknown> = {
			schema: NOTE_EVENT_SCHEMA,
			id: this.deps.ids.next(),
			note_id: noteId,
			seq: 1,
			entered_at: this.deps.clock.now(),
			entered_by: "lender",
			type: "note.created",
			terms: input.terms,
		};
		let event: NoteEvent;
		try {
			[event] = validateStream([created]) as [NoteEvent];
		} catch (error) {
			return failure("invalid_terms", validatorReason(error));
		}
		const claim = await this.deps.store.claimIdempotency(
			noteId,
			caller,
			idem,
			fingerprint,
		);
		if (claim === "different")
			return failure(
				"idempotency_conflict",
				"That idempotency key was used for a different request.",
			);
		const existing = await this.deps.store.readLog(noteId);
		if (existing.events.length > 0)
			return {
				ok: true,
				noteId,
				created: false,
				...(await this.agentField(noteId)),
			};
		await this.deps.store.putContacts(noteId, {
			lender: side.kind === "person" ? side.email : "",
			borrower,
		});
		let registered: RegisteredAgent[] = [];
		if (side.kind === "org" && this.deps.org)
			registered = await this.deps.org.registerNote(
				noteId,
				side.orgId,
				side.agents,
			);
		const [link] = await buildChain([event]);
		const written = await this.deps.store.append(noteId, SEQ_START, {
			eventJson: JSON.stringify(event),
			link: link as ChainLink,
		});
		// Another caller with the same key won the write: it sends the invites.
		if (!written.ok)
			return {
				ok: true,
				noteId,
				created: false,
				...(await this.agentField(noteId)),
			};
		try {
			if (side.kind === "person") {
				await this.sendInvite(noteId, "lender", side.email);
			} else if (this.deps.org) {
				for (const agent of registered)
					await this.deps.org.inviteAgent(side.orgId, agent, noteId);
			}
			await this.sendInvite(noteId, "borrower", borrower);
		} catch {
			return failure(
				"mail_failed",
				`The note ${noteId} was created but an invitation could not be sent; each party can ask for a new link.`,
			);
		}
		return {
			ok: true,
			noteId,
			created: true,
			...(await this.agentField(noteId)),
		};
	}

	/** Checks who the lender and the borrower are. A person lender or an organization with its agents, normalized. */
	private parseLender(
		lender: LenderInput,
		borrower: string,
	):
		| { kind: "person"; email: string }
		| {
				kind: "org";
				orgId: string;
				agents: { email: string; role: AgentRole }[];
		  }
		| Failure {
		if (!isPlausibleEmail(borrower))
			return failure("bad_request", "Both parties need an email address.");
		if ("org_id" in lender) {
			const { org_id: orgId, agents } = lender;
			if (typeof orgId !== "string" || !ORG_ID_PATTERN.test(orgId))
				return failure(
					"bad_request",
					"The organization id is 1 to 64 letters, digits, _ or -.",
				);
			if (!this.deps.org)
				return failure(
					"not_configured",
					"Organizations are not set up here yet.",
				);
			const parsed = parseAgents(agents);
			if ("ok" in parsed) return parsed;
			if (parsed.agents.some((agent) => agent.email === borrower))
				return failure(
					"same_party",
					"The borrower cannot be on the lender's team.",
				);
			return { kind: "org", orgId, agents: parsed.agents };
		}
		const email = normalizeEmail(lender.email);
		if (!isPlausibleEmail(email))
			return failure("bad_request", "Both parties need an email address.");
		if (email === borrower)
			return failure(
				"same_party",
				"The lender and the borrower need different email addresses.",
			);
		return { kind: "person", email };
	}

	/** The note's agents by ref and role, for the API caller: nothing for a person lender. No address is returned. */
	private async agentField(
		noteId: string,
	): Promise<{ agents?: AgentSummary[] }> {
		const agents = await this.deps.store.listAgents(noteId);
		if (agents.length === 0) return {};
		return {
			agents: agents.map((agent) => ({
				agentRef: agent.agentRef,
				role: agent.role,
				active: agent.active,
			})),
		};
	}

	/**
	 * A fresh link for the party whose address matches; that party's older links nobody opened stop working. The caller
	 * always answers the same text, whether or not an address matched or a limit was hit, so the answer reveals nothing
	 * about who is on a note, and the answer does not wait for the mail: the matching branch hands its work to `defer`,
	 * so the response takes the same time either way. The caller has already checked the note id (`isValidNoteId`):
	 * nothing is read or written for a made-up one. Limits: per address (counted by the sha256 of it, never the address)
	 * and per client (a keyed hash of `CF-Connecting-IP`, when there is one), each per note and hour, so a flood of junk
	 * addresses cannot use up the real party's allowance.
	 */
	async requestLink(
		noteId: string,
		email: string,
		clientIp?: string,
	): Promise<void> {
		const { store, clock } = this.deps;
		const address = normalizeEmail(email);
		const now = clock.now();
		const clientAllowed =
			clientIp === undefined
				? true
				: await store.hit(
						noteId,
						`link:client:${await hmac(this.deps.secret, `ip:${clientIp}`)}`,
						now,
						LINK_WINDOW_MS,
						LINK_REQUESTS_PER_CLIENT,
					);
		const addressAllowed = await store.hit(
			noteId,
			`link:address:${await hashPrefix(address)}`,
			now,
			LINK_WINDOW_MS,
			LINK_REQUESTS_PER_ADDRESS,
		);
		if (!(clientAllowed && addressAllowed)) return;
		const contacts = await store.getContacts(noteId);
		if (contacts === null || address === "") return;
		// An organization lender has no address on the note: its agents ask for a link on the organization's page.
		const lenderIsOrg = (await store.getOrg(noteId)) !== null;
		// Compare against both parties without stopping at the first match.
		const isLender =
			!lenderIsOrg && constantTimeEqual(address, contacts.lender);
		const isBorrower = constantTimeEqual(address, contacts.borrower);
		const role: Role | null = isLender
			? "lender"
			: isBorrower
				? "borrower"
				: null;
		if (role === null) return;
		(this.deps.defer ?? unawaited)(
			this.sendInvite(noteId, role, contacts[role], { replace: true }).catch(
				(error: unknown) => {
					console.error(
						`notes: link email failed: ${error instanceof Error ? error.name : "error"}`,
					);
				},
			),
		);
	}

	/** Emails a fresh step-up code for one kind of action to the session's own party. */
	async requestStepUp(
		session: ActiveSession,
		action: string,
	): Promise<Outcome<Record<never, never>>> {
		if (!isStepUpAction(action))
			return failure("bad_request", "That action does not need a code.");
		const denied = await this.gate(session, "act");
		if (denied) return denied;
		if (!(await this.sessions.canIssueCode(session)))
			return failure("rate_limited", "Too many codes. Try again in an hour.");
		const contacts = await this.deps.store.getContacts(session.noteId);
		if (contacts === null) return failure("not_found", "No such note.");
		// The code goes to the person acting: an agent's own address, never a shared one.
		const recipient = session.agent
			? (await this.deps.store.getAgent(session.noteId, session.agent.agentRef))
					?.email
			: contacts[session.role];
		if (recipient === undefined || recipient === "")
			return failure("not_found", "No such note.");
		const code = await this.sessions.issueCode(session, action);
		try {
			await this.deps.mailer.send({
				to: recipient,
				subject: "Your confirmation code",
				text: [
					`Your code is ${code}.`,
					"It works once, for ten minutes, for the step you just started.",
					"If you did not start one, ignore this email.",
				].join("\n"),
			});
		} catch {
			return failure(
				"mail_failed",
				"The code could not be sent. Try again later.",
			);
		}
		return { ok: true };
	}

	/**
	 * Enters one event for the session's party. The server fixes `id`, `note_id`, `seq`, `entered_at`, `entered_by`
	 * (the session's role) and `via` (`email-link`); a client that sends any of them, or `agent_ref`, is refused. The
	 * whole stream is re-validated with the candidate on the end, then chained and appended with compare-and-append
	 * (one retry when another writer got there first).
	 */
	async append(
		session: ActiveSession,
		input: unknown,
		options: { code?: string } = {},
	): Promise<Outcome<{ event: NoteEvent }>> {
		const prepared = this.prepare(session, input);
		if (!prepared.ok) return prepared;
		const denied = await this.gate(session, "act");
		if (denied) return denied;
		const { type, payload, rule } = prepared;
		let stepUpDone = false;
		for (let attempt = 0; attempt < MAX_APPEND_ATTEMPTS; attempt += 1) {
			const { raw, links } = await this.loadLog(session.noteId);
			if (raw.length === 0) return failure("not_found", "No such note.");
			const seq = raw.length + 1;
			const candidate = {
				schema: NOTE_EVENT_SCHEMA,
				id: this.deps.ids.next(),
				note_id: session.noteId,
				seq,
				entered_at: this.deps.clock.now(),
				entered_by: session.role,
				via: "email-link",
				...agentStamp(session),
				type,
				...payload,
			};
			let ordered: NoteEvent[];
			try {
				ordered = validateStream([...raw, candidate]);
				checkAppend(
					ordered.slice(0, -1),
					candidate,
					await this.policyOf(session),
				);
			} catch (error) {
				return failure("rejected", validatorReason(error));
			}
			const event = ordered[ordered.length - 1] as NoteEvent;
			if (rule.stepUp && !stepUpDone) {
				const checked = await this.checkStepUp(session, type, options.code);
				if (checked !== null) return checked;
				stepUpDone = true;
			}
			let link: ChainLink | undefined;
			try {
				link = (await extendChain(links, event)).at(-1);
			} catch (error) {
				return failure("bad_event", sentence(error));
			}
			const written = await this.deps.store.append(session.noteId, raw.length, {
				eventJson: JSON.stringify(event),
				link: link as ChainLink,
			});
			if (written.ok) return { ok: true, event };
		}
		return failure(
			"conflict",
			"The record changed while you were saving. Try again.",
		);
	}

	/** Checks the type, the role and the fields of a client event before any I/O; returns what the server will use. */
	private prepare(
		session: ActiveSession,
		input: unknown,
	):
		| {
				ok: true;
				type: string;
				payload: Record<string, unknown>;
				rule: EventRule;
		  }
		| Failure {
		if (!isRecord(input) || typeof input.type !== "string")
			return failure("bad_request", "Send an event with a type.");
		const { type } = input;
		const rule = EVENT_RULES[type];
		if (rule === undefined)
			return failure("forbidden_event", `A guest cannot enter ${type}.`);
		if (!rule.roles.includes(session.role))
			return failure("wrong_role", `The ${session.role} cannot enter ${type}.`);
		for (const field of SERVER_FIELDS) {
			if (field in input)
				return failure(
					"forbidden_field",
					`${field} is set by the server and cannot be sent.`,
				);
		}
		const payload: Record<string, unknown> = {};
		for (const [field, value] of Object.entries(input)) {
			if (field === "type") continue;
			if (!rule.fields.includes(field))
				return failure("bad_event", `${field} is not a field of ${type}.`);
			if (typeof value === "string") {
				const text = cleanText(value.trim());
				if (text === null)
					return failure(
						"bad_event",
						`${field} is too long or not valid text.`,
					);
				if (text !== "") payload[field] = text;
			} else if (value !== undefined) payload[field] = value;
		}
		return { ok: true, type, payload, rule };
	}

	/** Null when the code is good (and now spent), else the failure to return. */
	private async checkStepUp(
		session: ActiveSession,
		type: string,
		code: string | undefined,
	): Promise<Failure | null> {
		if (code === undefined || code.trim() === "")
			return failure("step_up_required", "Enter the code we emailed you.");
		const checked = await this.sessions.checkCode(session, type, code);
		switch (checked) {
			case "ok":
				return null;
			case "none":
				return failure("step_up_required", "Ask for a new code and enter it.");
			case "expired":
				return failure(
					"step_up_invalid",
					"That code has expired. Ask for a new one.",
				);
			case "locked":
				return failure(
					"step_up_invalid",
					"Too many wrong tries. Try again in an hour.",
				);
			default:
				return failure("step_up_invalid", "That code is not right.");
		}
	}

	/**
	 * Statement as of today (UTC date of the clock, never before the issue date), chain verdict and what needs this
	 * party. A log that no longer reads as a valid stream answers `chain_invalid`; one that reads but does not match its
	 * chain still answers, with `chain` saying what failed, so the page can show the failed check.
	 */
	async view(session: ActiveSession): Promise<Outcome<{ view: NoteView }>> {
		const log = await this.loadLog(session.noteId);
		if (log.raw.length === 0) return failure("not_found", "No such note.");
		let agent = session.agent;
		if (agent !== undefined) {
			const role = this.deps.org
				? await this.deps.org.roleOnNote(
						agent.orgId,
						session.noteId,
						agent.agentRef,
					)
				: null;
			if (role === null) return failure("not_found", "No such note.");
			agent = { ...agent, role };
		}
		let events: NoteEvent[];
		try {
			events = validateStream(log.raw);
		} catch (error) {
			return failure(
				"chain_invalid",
				`Record check failed (${validatorReason(error)}). Do not rely on this record.`,
			);
		}
		return {
			ok: true,
			view: await this.buildView(session, agent, log, events),
		};
	}

	private async buildView(
		session: ActiveSession,
		agent: AgentIdentity | undefined,
		log: { raw: unknown[]; links: ChainLink[] },
		events: NoteEvent[],
	): Promise<NoteView> {
		const { noteId, role } = session;
		const created = events[0];
		if (created?.type !== "note.created")
			throw new Error("log has no note.created");
		const asOf = this.asOf(created.terms.issue_date);
		const current = statement(events, asOf);
		const contacts = await this.deps.store.getContacts(noteId);
		const stored = await this.deps.store.listDocuments(noteId);
		const lenderIsOrg = (await this.deps.store.getOrg(noteId)) !== null;
		const release = releaseSummary(
			events,
			current.state,
			stored,
			this.releaseCoolingMs,
		);
		return {
			noteId,
			basePath: basePathOf(session),
			role,
			lenderIsOrg,
			org: agent
				? orgViewOf(
						events,
						agent,
						release.draft?.id ?? null,
						await this.policyOf(session),
					)
				: null,
			asOf,
			terms: created.terms,
			statement: current,
			chain: await verifyChain(events, log.links, noteId),
			state: current.state,
			events,
			// An agent never sees even a masked borrower address, and nobody sees an agent's.
			masked: {
				lender: maskEmail(contacts?.lender ?? ""),
				borrower: agent
					? "the borrower's address"
					: maskEmail(contacts?.borrower ?? ""),
			},
			needsYou: awaitingRole(events, current, role),
			documents: stored.map(({ id, type, eventId, createdAt }) => ({
				id,
				type,
				eventId,
				createdAt,
			})),
			release,
			sharing: sharingViewOf({
				events,
				grants: grantsOf(events, this.deps.clock.now()),
				shares: await this.deps.store.listShares(noteId),
				role,
				agentRef: agent?.agentRef,
				canAct: agent?.role !== "viewer",
			}),
		};
	}

	private asOf(issueDate: string): string {
		const today = this.deps.clock.now().slice(0, DATE_LENGTH);
		return today < issueDate ? issueDate : today;
	}

	/** For the API caller: the statement for `asOf` (default today) and the chain verdict. */
	async statementFor(
		noteId: string,
		asOf?: string,
	): Promise<Outcome<{ statement: Statement; chain: ChainVerdict }>> {
		const { raw, links } = await this.loadLog(noteId);
		if (raw.length === 0) return failure("not_found", "No such note.");
		if (asOf !== undefined && !isValidCivilDate(asOf))
			return failure("bad_request", "as_of must be a date, YYYY-MM-DD.");
		const events = validateStream(raw);
		const created = events[0];
		if (created?.type !== "note.created")
			throw new Error("log has no note.created");
		const date = asOf ?? this.asOf(created.terms.issue_date);
		let current: Statement;
		try {
			current = statement(events, date);
		} catch (error) {
			return failure("bad_request", sentence(error));
		}
		return {
			ok: true,
			statement: current,
			chain: await verifyChain(events, links, noteId),
		};
	}

	// ---- signed documents, release and notices (build step 3) ----

	/** A failure when this session's party may not take `action`, else null. */
	private roleCheck(session: ActiveSession, action: string): Failure | null {
		const rule = LENDER_ACTIONS[action];
		if (rule?.roles.includes(session.role)) return null;
		return failure("wrong_role", `The ${session.role} cannot enter ${action}.`);
	}

	/**
	 * For an organization agent, a failure when they may not take this step now, else null. The role is read live from the
	 * organization (never from the session), so a deactivated agent or a viewer is refused here whatever their session
	 * says. `approve` is for board members only. A guest session passes `act` and never `approve`.
	 */
	private async gate(
		session: ActiveSession,
		need: "act" | "approve",
	): Promise<Failure | null> {
		const { agent } = session;
		if (agent === undefined)
			return need === "approve"
				? failure("wrong_role", "Only a board member can approve a request.")
				: null;
		const role = this.deps.org
			? await this.deps.org.roleOnNote(
					agent.orgId,
					session.noteId,
					agent.agentRef,
				)
			: null;
		if (role === null)
			return failure("wrong_role", "Your access to this record has ended.");
		if (role === "viewer")
			return failure(
				"wrong_role",
				"A viewer can read this record but not change it.",
			);
		if (need === "approve" && role !== "board")
			return failure(
				"wrong_role",
				"Only a board member can approve a request.",
			);
		return null;
	}

	private signers(): Outcome<{ signers: DocumentSigners }> {
		const { signers } = this.deps;
		if (!signers)
			return failure(
				"not_configured",
				"Signed documents are not set up here yet.",
			);
		return { ok: true, signers };
	}

	/**
	 * The note's log, read and checked as a whole: it must parse, read as a valid stream and match its chain. Anything
	 * that issues a document starts here, so a log that was edited after it was chained is never signed over.
	 */
	private async loadVerified(noteId: string): Promise<Outcome<Loaded>> {
		let log: { raw: unknown[]; links: ChainLink[] };
		let events: NoteEvent[];
		try {
			log = await this.loadLog(noteId);
			if (log.raw.length === 0) return failure("not_found", "No such note.");
			events = validateStream(log.raw);
		} catch (error) {
			return failure(
				"chain_invalid",
				`Record check failed (${validatorReason(error)}). Nothing was signed.`,
			);
		}
		const verdict = await verifyChain(events, log.links, noteId);
		if (!verdict.ok)
			return failure(
				"chain_invalid",
				`Record check failed (${verdict.reason}${verdict.seq === undefined ? "" : ` at entry ${verdict.seq}`}). Nothing was signed.`,
			);
		return { ok: true, ...log, events };
	}

	private storedDocument(
		body: NoteDocumentBody,
		signed: unknown,
		eventId: string | null,
		sha256: string,
		now: string,
		variant = "",
	): StoredDocument {
		return {
			id: this.deps.ids.next(),
			type: body.type,
			eventId,
			variant,
			sha256,
			json: JSON.stringify(signed),
			createdAt: now,
		};
	}

	/**
	 * Appends one lender event whose fields the server fixes. `prepare` runs on the freshly validated log (once per
	 * attempt) and returns the payload, plus a document to store in the same atomic step, or a failure. The step-up
	 * code, when asked for, is checked once, after `prepare` and the stream rules, like `append`. Compare-and-append with
	 * one retry when another writer got there first.
	 */
	private async commit(
		session: ActiveSession,
		type: string,
		prepare: (context: {
			loaded: Loaded;
			eventId: string;
			now: string;
		}) => Promise<
			Failure | { payload: Record<string, unknown>; document?: StoredDocument }
		>,
		stepUp?: { code: string | undefined; action?: string },
	): Promise<Outcome<{ event: NoteEvent; document?: StoredDocument }>> {
		let stepUpDone = false;
		for (let attempt = 0; attempt < MAX_APPEND_ATTEMPTS; attempt += 1) {
			const loaded = await this.loadVerified(session.noteId);
			if (!loaded.ok) return loaded;
			const eventId = this.deps.ids.next();
			const now = this.deps.clock.now();
			const prepared = await prepare({ loaded, eventId, now });
			if ("ok" in prepared) return prepared;
			const candidate = {
				schema: NOTE_EVENT_SCHEMA,
				id: eventId,
				note_id: session.noteId,
				seq: loaded.raw.length + 1,
				entered_at: now,
				entered_by: session.role,
				via: "email-link",
				...agentStamp(session),
				type,
				...prepared.payload,
			};
			let ordered: NoteEvent[];
			try {
				ordered = validateStream([...loaded.raw, candidate]);
			} catch (error) {
				return failure("rejected", validatorReason(error));
			}
			const policy = await this.policyOf(session);
			try {
				checkAppend(ordered.slice(0, -1), candidate, policy);
			} catch (error) {
				return approvalFailure(
					type,
					ordered.slice(0, -1),
					candidate,
					error,
					policy,
				);
			}
			const event = ordered[ordered.length - 1] as NoteEvent;
			if (stepUp && !stepUpDone) {
				const checked = await this.checkStepUp(
					session,
					stepUp.action ?? type,
					stepUp.code,
				);
				if (checked !== null) return checked;
				stepUpDone = true;
			}
			let link: ChainLink | undefined;
			try {
				link = (await extendChain(loaded.links, event)).at(-1);
			} catch (error) {
				return failure("bad_event", sentence(error));
			}
			const written = await this.deps.store.append(
				session.noteId,
				loaded.raw.length,
				{
					eventJson: JSON.stringify(event),
					link: link as ChainLink,
					...(prepared.document ? { document: prepared.document } : {}),
				},
			);
			if (written.ok)
				return {
					ok: true,
					event,
					...(prepared.document ? { document: prepared.document } : {}),
				};
		}
		return failure(
			"conflict",
			"The record changed while you were saving. Try again.",
		);
	}

	/** Seals after an issuance. A seal that cannot be signed must not undo the document just issued; the next bundle retries. */
	private async sealQuietly(noteId: string): Promise<void> {
		const sealed = await this.sealChain(noteId);
		if (!sealed.ok)
			console.error(`notes: chain seal not written: ${sealed.error}`);
	}

	/**
	 * A signed receipt for one recorded payment, built against the chain head as it stands now. Either party may ask. A
	 * payment has one receipt per status label ("claimed by borrower", "confirmed", "disputed", ...): asking again while
	 * the label is the same returns the same stored bytes, and once the label has changed (a confirmation, a dispute, a
	 * reversal) a new receipt is issued at the new chain head. A receipt holds only the entries up to its chain position.
	 */
	async issueReceipt(
		session: ActiveSession,
		paymentEventId: unknown,
	): Promise<Outcome<{ document: StoredDocument; created: boolean }>> {
		const gated = await this.gate(session, "act");
		if (gated) return gated;
		const configured = this.signers();
		if (!configured.ok) return configured;
		if (typeof paymentEventId !== "string" || paymentEventId === "")
			return failure("bad_request", "Say which payment the receipt is for.");
		const loaded = await this.loadVerified(session.noteId);
		if (!loaded.ok) return loaded;
		const now = this.deps.clock.now();
		let body: NoteDocumentBody;
		try {
			body = await paymentReceiptBody(
				loaded.events,
				paymentEventId,
				loaded.links,
				now,
			);
		} catch {
			return failure("bad_request", "That is not a payment on this note.");
		}
		const label = body.type === "note.payment-receipt" ? body.status : "";
		const existing = (await this.deps.store.listDocuments(session.noteId)).find(
			(document) =>
				document.type === "note.payment-receipt" &&
				document.eventId === paymentEventId &&
				document.variant === label,
		);
		if (existing) return { ok: true, document: existing, created: false };
		const signed = await signDocument(body, configured.signers.receipt);
		const candidate = this.storedDocument(
			body,
			signed,
			paymentEventId,
			await documentSha256(body),
			now,
			label,
		);
		const stored = await this.deps.store.putDocumentOnce(
			session.noteId,
			candidate,
		);
		const created = stored.id === candidate.id;
		if (created) await this.sealQuietly(session.noteId);
		return { ok: true, document: stored, created };
	}

	/**
	 * Lender only. Builds the payoff statement for `asOf` (a date, the only thing the client sends), signs it, and
	 * appends `payoff.issued` carrying the sha256 of the signed body. The document and the event are stored together.
	 */
	async issuePayoff(
		session: ActiveSession,
		asOf: unknown,
	): Promise<Outcome<{ event: NoteEvent; document: StoredDocument }>> {
		const denied = this.roleCheck(session, "payoff.issued");
		if (denied) return denied;
		const gated = await this.gate(session, "act");
		if (gated) return gated;
		const configured = this.signers();
		if (!configured.ok) return configured;
		if (typeof asOf !== "string" || !isValidCivilDate(asOf))
			return failure("bad_request", "Enter a date, YYYY-MM-DD.");
		const today = this.deps.clock.now().slice(0, DATE_LENGTH);
		if (asOf > addDays(today, MAX_PAYOFF_DAYS_AHEAD))
			return failure(
				"bad_request",
				"Choose a date within a year of today for a payoff statement.",
			);
		const allowed = await this.deps.store.hit(
			session.noteId,
			"payoff",
			this.deps.clock.now(),
			PAYOFF_WINDOW_MS,
			PAYOFFS_PER_HOUR,
		);
		if (!allowed)
			return failure(
				"rate_limited",
				"Too many payoff statements. Try again later.",
			);
		const result = await this.commit(
			session,
			"payoff.issued",
			async (context) => {
				if (this.stateOf(context.loaded.events).terms === "declined")
					return failure("terms_declined", REJECTED_DECLINED);
				let body: NoteDocumentBody;
				try {
					body = await payoffStatementBody(
						context.loaded.events,
						asOf,
						context.loaded.links,
						context.now,
					);
				} catch (error) {
					return failure("bad_request", sentence(error));
				}
				const sha256 = await documentSha256(body);
				const signed = await signDocument(body, configured.signers.receipt);
				return {
					payload: { as_of: asOf, document_sha256: sha256 },
					document: this.storedDocument(
						body,
						signed,
						context.eventId,
						sha256,
						context.now,
					),
				};
			},
		);
		if (!result.ok) return result;
		await this.sealQuietly(session.noteId);
		return {
			ok: true,
			event: result.event,
			document: result.document as StoredDocument,
		};
	}

	/** Lender only. Records that a release is drafted; it can be confirmed after the cooling-off. Changes no balance. */
	async draftRelease(
		session: ActiveSession,
	): Promise<Outcome<{ event: NoteEvent }>> {
		const denied = this.roleCheck(session, "release.drafted");
		if (denied) return denied;
		const gated = await this.gate(session, "act");
		if (gated) return gated;
		const result = await this.commit(
			session,
			"release.drafted",
			async ({ loaded }) => {
				const state = this.stateOf(loaded.events);
				if (state.closed)
					return failure("rejected", "This note is already released.");
				const summary = releaseSummary(loaded.events, state, [], 0);
				if (summary.draft !== null)
					return failure("rejected", "A release is already drafted.");
				return { payload: {} };
			},
		);
		if (!result.ok) return result;
		return { ok: true, event: result.event };
	}

	/**
	 * Lender only. Confirms a drafted release: after the cooling-off (`cooling_off` with the instant it ends, checked
	 * before any code is spent) and with the emailed code. Then issues and stores the signed `note.release` document.
	 * Confirming a draft that is already confirmed returns the release again and issues its document if it is missing.
	 * A release states what the lender says; it never changes a balance.
	 */
	async confirmRelease(
		session: ActiveSession,
		draftId: unknown,
		options: { code?: string } = {},
	): Promise<Outcome<{ event: NoteEvent; document: StoredDocument }>> {
		const denied = this.roleCheck(session, "release.confirmed");
		if (denied) return denied;
		const gated = await this.gate(session, "act");
		if (gated) return gated;
		const configured = this.signers();
		if (!configured.ok) return configured;
		if (typeof draftId !== "string" || draftId === "")
			return failure("bad_request", "Say which draft to confirm.");
		const before = await this.loadVerified(session.noteId);
		if (!before.ok) return before;
		const already = before.events.find(
			(event) => event.type === "release.confirmed" && event.target === draftId,
		);
		if (already) return this.releaseDocumentFor(session.noteId, already);
		const result = await this.commit(
			session,
			"release.confirmed",
			async ({ loaded, now }) => {
				const draft = loaded.events.find(
					(event) => event.id === draftId && event.type === "release.drafted",
				);
				if (draft === undefined)
					return failure("bad_request", "No such release draft.");
				if (
					loaded.events.some(
						(event) =>
							event.type === "release.confirmed" && event.target === draftId,
					)
				)
					return failure("conflict", "That release was just confirmed.");
				const until = new Date(
					Date.parse(draft.entered_at) + this.releaseCoolingMs,
				).toISOString();
				if (Date.parse(now) < Date.parse(until))
					return failure(
						"cooling_off",
						`A release can be confirmed from ${until.slice(0, MINUTE_LENGTH).replace("T", " ")} UTC, after the cooling-off since the draft.`,
						{ until },
					);
				return { payload: { target: draftId } };
			},
			{ code: options.code },
		);
		if (!result.ok) return result;
		return this.releaseDocumentFor(session.noteId, result.event);
	}

	/** The release document for a `release.confirmed` event: the stored one, or a newly signed one. */
	private async releaseDocumentFor(
		noteId: string,
		event: NoteEvent,
	): Promise<Outcome<{ event: NoteEvent; document: StoredDocument }>> {
		const configured = this.signers();
		if (!configured.ok) return configured;
		const loaded = await this.loadVerified(noteId);
		if (!loaded.ok) return loaded;
		const now = this.deps.clock.now();
		const body = await releaseBody(loaded.events, event.id, loaded.links, now);
		const signed = await signDocument(body, configured.signers.receipt);
		const candidate = this.storedDocument(
			body,
			signed,
			event.id,
			await documentSha256(body),
			now,
		);
		const stored = await this.deps.store.putDocumentOnce(noteId, candidate);
		if (stored.id === candidate.id) await this.sealQuietly(noteId);
		return { ok: true, event, document: stored };
	}

	/**
	 * Lender only. Records a notice and emails the borrower that one was recorded (no amount, no claim: "open your
	 * note"). A `default` notice needs the emailed code and `cure_days` from 0 to 365; a `reminder` takes neither. The
	 * event is recorded even when the email cannot be sent: `mailed` says which.
	 */
	async sendNotice(
		session: ActiveSession,
		input: { kind: unknown; cure_days?: unknown },
		options: { code?: string } = {},
	): Promise<Outcome<{ event: NoteEvent; mailed: boolean }>> {
		const denied = this.roleCheck(session, "notice.sent");
		if (denied) return denied;
		const gated = await this.gate(session, "act");
		if (gated) return gated;
		const { kind, cure_days: cureDays } = input;
		if (kind !== "reminder" && kind !== "default")
			return failure("bad_request", "Choose a reminder or a default notice.");
		const hasCure = cureDays !== undefined && cureDays !== null;
		if (kind === "reminder" && hasCure)
			return failure("bad_request", "A reminder has no cure period.");
		if (
			kind === "default" &&
			!(
				typeof cureDays === "number" &&
				Number.isInteger(cureDays) &&
				cureDays >= 0 &&
				cureDays <= MAX_CURE_DAYS
			)
		)
			return failure(
				"bad_request",
				`Enter cure days from 0 to ${MAX_CURE_DAYS}.`,
			);
		const contacts = await this.deps.store.getContacts(session.noteId);
		if (contacts === null) return failure("not_found", "No such note.");
		// Asking for a code is not a notice: only a reminder or a notice with its code uses up the daily limit.
		const consumes = kind === "reminder" || options.code !== undefined;
		if (consumes) {
			const allowed = await this.deps.store.hit(
				session.noteId,
				"notice",
				this.deps.clock.now(),
				NOTICE_WINDOW_MS,
				NOTICES_PER_DAY,
			);
			if (!allowed)
				return failure(
					"rate_limited",
					"Too many notices today. Try again tomorrow.",
				);
		}
		const agents = await this.policyOf(session);
		const result = await this.commit(
			session,
			"notice.sent",
			async ({ loaded }) => {
				if (this.stateOf(loaded.events).terms === "declined")
					return failure("terms_declined", REJECTED_DECLINED);
				if (kind === "reminder") return { payload: { kind } };
				// An organization's default notice names the approval it uses: which request, by its id.
				if (session.agent === undefined)
					return { payload: { kind, cure_days: cureDays } };
				const picked = pickNoticeApproval(
					loaded.events,
					cureDays as number,
					agents,
				);
				if ("ok" in picked) return picked;
				return {
					payload: { kind, cure_days: cureDays, approval: picked.requestId },
				};
			},
			kind === "default" ? { code: options.code } : undefined,
		);
		if (!result.ok) return result;
		const mail = noticeEmail(session.noteId, this.deps.baseUrl);
		try {
			await this.deps.mailer.send({ to: contacts.borrower, ...mail });
		} catch {
			return { ok: true, event: result.event, mailed: false };
		}
		return { ok: true, event: result.event, mailed: true };
	}

	/**
	 * Organization lender only, treasurer or board. Records that a second person is asked to approve one of the
	 * three two-person steps. `target` is the release draft for `release.confirm`; for `notice.default` and `waiver` it is
	 * an earlier entry the requester names, normally the note that drafts the text. A release is asked for once; a default
	 * notice or a waiver may be asked again once the earlier request has its approval.
	 */
	async requestApproval(
		session: ActiveSession,
		input: { action: unknown; target: unknown; cure_days?: unknown },
	): Promise<Outcome<{ event: NoteEvent }>> {
		if (session.agent === undefined)
			return failure(
				"wrong_role",
				"Approvals belong to a lender that is an organization.",
			);
		const denied = await this.gate(session, "act");
		if (denied) return denied;
		const { action, target } = input;
		if (!isApprovalAction(action))
			return failure(
				"bad_request",
				"Choose what the approval is for: confirming a release, a default notice or a waiver.",
			);
		if (typeof target !== "string" || target === "" || target.length > 200)
			return failure("bad_request", "Say what the approval is about.");
		const cureDays = input.cure_days;
		if (
			action === "notice.default" &&
			!(
				typeof cureDays === "number" &&
				Number.isInteger(cureDays) &&
				cureDays >= 0 &&
				cureDays <= MAX_CURE_DAYS
			)
		)
			return failure(
				"bad_request",
				`Say how many days to cure the default notice gives, from 0 to ${MAX_CURE_DAYS}.`,
			);
		if (action !== "notice.default" && cureDays !== undefined)
			return failure("bad_request", "Only a default notice has cure days.");
		const agents = await this.policyOf(session);
		const result = await this.commit(
			session,
			"approval.requested",
			async ({ loaded }) => {
				const known = loaded.events.find((event) => event.id === target);
				if (
					action === "notice.default" &&
					this.stateOf(loaded.events).terms === "declined"
				)
					return failure("terms_declined", REJECTED_DECLINED);
				if (action === "release.confirm") {
					if (known?.type !== "release.drafted")
						return failure("bad_request", "No such release draft.");
					if (
						loaded.events.some(
							(event) =>
								event.type === "release.confirmed" && event.target === target,
						)
					)
						return failure("rejected", "That release is already confirmed.");
					if (
						loaded.events.some(
							(event) =>
								event.type === "approval.requested" &&
								event.action === action &&
								event.target === target,
						)
					)
						return failure(
							"rejected",
							"An approval was already asked for this release.",
						);
				} else {
					if (known === undefined)
						return failure(
							"bad_request",
							"That is not an entry of this record.",
						);
					const waiting = pendingApprovals(loaded.events, agents).some(
						(pending) => pending.action === action && pending.target === target,
					);
					if (waiting)
						return failure(
							"rejected",
							"An approval for this is already waiting for a board member.",
						);
				}
				return {
					payload:
						action === "notice.default"
							? { action, target, cure_days: cureDays }
							: { action, target },
				};
			},
		);
		if (!result.ok) return result;
		return { ok: true, event: result.event };
	}

	/**
	 * Organization lender only, board only. Approves one request. The stream rules refuse the requester approving their own
	 * request and a second approval from the same agent. A waiver also gets an annotation saying what was approved; the
	 * engine has no event that forgives money, so a waiver changes no balance.
	 */
	async grantApproval(
		session: ActiveSession,
		requestId: unknown,
	): Promise<Outcome<{ event: NoteEvent; annotation?: NoteEvent }>> {
		if (session.agent === undefined)
			return failure(
				"wrong_role",
				"Approvals belong to a lender that is an organization.",
			);
		const denied = await this.gate(session, "approve");
		if (denied) return denied;
		if (typeof requestId !== "string" || requestId === "")
			return failure("bad_request", "Say which request to approve.");
		let action: ApprovalAction | undefined;
		const result = await this.commit(
			session,
			"approval.granted",
			async ({ loaded }) => {
				const request = loaded.events.find(
					(event) =>
						event.id === requestId && event.type === "approval.requested",
				);
				if (request?.type !== "approval.requested")
					return failure("bad_request", "No such approval request.");
				action = request.action;
				return { payload: { request: requestId } };
			},
		);
		if (!result.ok) return result;
		if (action !== "waiver") return { ok: true, event: result.event };
		const annotated = await this.commit(
			session,
			"annotation.added",
			async () => ({ payload: { text: WAIVER_ANNOTATION, target: requestId } }),
		);
		return annotated.ok
			? { ok: true, event: result.event, annotation: annotated.event }
			: { ok: true, event: result.event };
	}

	/**
	 * Signs the note's current chain head with the seal key and keeps it as the latest seal. A seal already stored for
	 * this exact head is returned as it is. Refused when the log no longer matches its chain.
	 */
	async sealChain(noteId: string): Promise<Outcome<{ seal: StoredSeal }>> {
		const configured = this.signers();
		if (!configured.ok) return configured;
		const loaded = await this.loadVerified(noteId);
		if (!loaded.ok) return loaded;
		const head = await chainHead(loaded.links);
		const stored = await this.deps.store.getSeal(noteId);
		if (stored?.headSeq === head.seq) {
			const parsed: unknown = JSON.parse(stored.json);
			if (isRecord(parsed) && parsed.head_hash === head.head_hash)
				return { ok: true, seal: stored };
		}
		const body = await chainSealBody(
			noteId,
			loaded.links,
			this.deps.clock.now(),
		);
		const signed = await signDocument(body, configured.signers.seal);
		const seal: StoredSeal = {
			headSeq: body.head_seq,
			sealedAt: body.sealed_at,
			json: JSON.stringify(signed),
		};
		await this.deps.store.putSeal(noteId, seal);
		return { ok: true, seal };
	}

	/** One stored document of this session's note, parsed; a document that names another note is not found. */
	async document(
		session: ActiveSession,
		docId: string,
	): Promise<
		Outcome<{ document: StoredDocument; signed: Record<string, unknown> }>
	> {
		const found = await this.deps.store.getDocument(session.noteId, docId);
		if (found === null) return failure("not_found", "No such document.");
		let signed: unknown;
		try {
			signed = JSON.parse(found.json);
		} catch {
			return failure("not_found", "No such document.");
		}
		if (!isRecord(signed) || signed.note_id !== session.noteId)
			return failure("not_found", "No such document.");
		return { ok: true, document: found, signed };
	}

	/** The bundle for the session's note (either party). */
	bundle(session: ActiveSession): Promise<Outcome<{ bundle: NoteBundleFile }>> {
		return this.bundleOf(session.noteId);
	}

	/**
	 * Everything an offline verifier needs but the public keys: the events, their links, the signed documents and the
	 * latest seal (refreshed first when the log still matches its chain, so it names the current head). The events hold
	 * no personal data by design: parties are roles, never names or emails. An annotation is the one free-text field and
	 * it is the parties' own words; annotations stay in the bundle because dropping an event would break its chain.
	 * A log that does not match its chain is still returned, so the verifier can say what failed.
	 */
	async bundleOf(noteId: string): Promise<Outcome<{ bundle: NoteBundleFile }>> {
		let log: { raw: unknown[]; links: ChainLink[] };
		try {
			log = await this.loadLog(noteId);
		} catch {
			return failure("chain_invalid", "The record could not be read.");
		}
		if (log.raw.length === 0) return failure("not_found", "No such note.");
		let seal = await this.deps.store.getSeal(noteId);
		if (this.deps.signers) {
			const fresh = await this.sealChain(noteId);
			if (fresh.ok) seal = fresh.seal;
		}
		const documents = await this.deps.store.listDocuments(noteId);
		return {
			ok: true,
			bundle: {
				events: log.raw,
				links: log.links,
				documents: documents.map((document): unknown =>
					JSON.parse(document.json),
				),
				seal: seal === null ? null : (JSON.parse(seal.json) as unknown),
			},
		};
	}

	// ---- sharing (build step 5) ----

	/** The note's grants as of now, from a log read and checked as a whole. Mutating steps never read a stale copy. */
	private grantsNow(loaded: Loaded): Grant[] {
		return grantsOf(loaded.raw, this.deps.clock.now());
	}

	/**
	 * Writes the share's store row first (an address is kept only there), then appends the `grant.proposed` event with
	 * the server's own grant id, opaque reference and expiry. A carve-out is active on the proposer's consent alone, so
	 * its recipient is emailed at once; anything else stays pending until the other party consents.
	 */
	private async proposeGrant(
		session: ActiveSession,
		spec: {
			kind: "person" | "link";
			recipientEmail: string | null;
			level: "summary" | "statement" | "verify";
			days: number;
			carveOut: { purpose: string } | null;
		},
	): Promise<
		Outcome<{
			grantId: string;
			status: GrantStatus;
			/** True or false for a recipient emailed now; null when nobody was emailed. */
			mailed: boolean | null;
		}>
	> {
		const { noteId } = session;
		const { store, ids, clock } = this.deps;
		const grantId = ids.next();
		const audienceRef =
			spec.kind === "person" ? personRefOf(ids.next()) : linkRefOf(ids.next());
		await store.putShare(noteId, {
			grantId,
			kind: spec.kind,
			audienceRef,
			recipientEmail: spec.recipientEmail,
			linkHash: null,
			linkUsedAt: null,
			createdAt: clock.now(),
		});
		let expiresAt = "";
		const result = await this.commit(
			session,
			"visibility.changed",
			async ({ now }) => {
				expiresAt = expiryAfter(now, spec.days);
				return {
					payload: {
						change: "grant.proposed",
						grant_id: grantId,
						audience: { kind: spec.kind, ref: audienceRef },
						level: spec.level,
						expires_at: expiresAt,
						...(spec.carveOut === null
							? {}
							: { purpose: spec.carveOut.purpose, carve_out: true }),
					},
				};
			},
		);
		if (!result.ok) return result;
		if (spec.carveOut === null || spec.recipientEmail === null)
			return { ok: true, grantId, status: "pending", mailed: null };
		const mailed = await this.sendShareLink(
			noteId,
			grantId,
			spec.recipientEmail,
			expiresAt,
			false,
		);
		await this.notifyOtherParty(session, {
			recipientEmail: spec.recipientEmail,
			purpose: spec.carveOut.purpose as GrantPurpose,
			expiresAt,
		});
		return { ok: true, grantId, status: "active", mailed };
	}

	/**
	 * Tells the party who did not make a disclosure that it exists: the proposer needs no consent from them, so this
	 * email is how they hear of it. For an organization lender the other party is its team (treasurers and board
	 * members); for a person it is the address on the note. Best effort: the disclosure stands and is listed on the
	 * other party's page even when a message cannot be sent.
	 */
	private async notifyOtherParty(
		session: ActiveSession,
		disclosure: {
			recipientEmail: string;
			purpose: GrantPurpose;
			expiresAt: string;
		},
	): Promise<void> {
		const { store, mailer, baseUrl } = this.deps;
		const { noteId } = session;
		const contacts = await store.getContacts(noteId);
		if (contacts === null) return;
		const orgId = await store.getOrg(noteId);
		const targets: { to: string; url: string }[] = [];
		if (session.role === "lender") {
			targets.push({ to: contacts.borrower, url: `${baseUrl}/n/${noteId}` });
		} else if (orgId === null) {
			targets.push({ to: contacts.lender, url: `${baseUrl}/n/${noteId}` });
		} else {
			for (const agent of await store.listAgents(noteId)) {
				if (agent.active && agent.role !== "viewer")
					targets.push({
						to: agent.email,
						url: `${baseUrl}${orgNotePath(orgId, noteId)}`,
					});
			}
		}
		for (const target of targets) {
			try {
				await mailer.send({
					to: target.to,
					...disclosureEmail({ ...disclosure, notePageUrl: target.url }),
				});
			} catch (error) {
				console.error(
					`notes: disclosure email failed: ${error instanceof Error ? error.name : "error"}`,
				);
			}
		}
	}

	/**
	 * Issues a single-use view link for a person share and emails it. Null when a link was already issued (and `replace`
	 * is off): nothing is sent twice. False when the mail could not be sent: the share stands, and its proposer can ask
	 * for the link again.
	 */
	private async sendShareLink(
		noteId: string,
		grantId: string,
		recipientEmail: string,
		expiresAt: string,
		replace: boolean,
	): Promise<boolean | null> {
		const token = this.deps.ids.token(SHARE_TOKEN_BYTES);
		const written = await this.deps.store.issueShareLink(
			noteId,
			grantId,
			await sha256Hex(token),
			replace,
		);
		if (!written) return null;
		const link = `${this.deps.baseUrl}/s/${noteId}/${grantId}/enter?t=${token}`;
		try {
			await this.deps.mailer.send({
				to: recipientEmail,
				...shareEmail(link, expiresAt),
			});
		} catch {
			return false;
		}
		return true;
	}

	/**
	 * Proposes sharing with a named person: `{ recipient_email, level: "summary" | "statement", days?, carve_out?: {
	 * purpose } }`. Either party (for an organization lender: a treasurer or board member). The event stores an opaque
	 * reference, never the address. Unless it is a carve-out, nothing is emailed until the other party consents.
	 */
	async proposeShare(
		session: ActiveSession,
		input: unknown,
	): Promise<
		Outcome<{
			grantId: string;
			status: GrantStatus;
			mailed: boolean | null;
		}>
	> {
		const denied = await this.gate(session, "act");
		if (denied) return denied;
		const parsed = parseProposal(input);
		if ("ok" in parsed) return parsed;
		const limited = await this.shareRateLimit(session.noteId);
		if (limited) return limited;
		return this.proposeGrant(session, {
			kind: "person",
			recipientEmail: parsed.recipientEmail,
			level: parsed.level,
			days: parsed.days,
			carveOut: parsed.carveOut,
		});
	}

	/** A verify link: a `link` audience at level `verify`. The other party must consent; the token comes later, once. */
	async createVerifyLink(
		session: ActiveSession,
		input: { days?: unknown },
	): Promise<Outcome<{ grantId: string; status: GrantStatus }>> {
		const denied = await this.gate(session, "act");
		if (denied) return denied;
		const days = parseDays(input.days);
		if (typeof days !== "number") return days;
		const limited = await this.shareRateLimit(session.noteId);
		if (limited) return limited;
		const proposed = await this.proposeGrant(session, {
			kind: "link",
			recipientEmail: null,
			level: "verify",
			days,
			carveOut: null,
		});
		return proposed.ok
			? { ok: true, grantId: proposed.grantId, status: proposed.status }
			: proposed;
	}

	private async shareRateLimit(noteId: string): Promise<Failure | null> {
		const allowed = await this.deps.store.hit(
			noteId,
			"share",
			this.deps.clock.now(),
			SHARE_WINDOW_MS,
			SHARES_PER_DAY,
		);
		return allowed
			? null
			: failure("rate_limited", "Too many shares today. Try again tomorrow.");
	}

	/**
	 * The other party consents to a pending share, with the emailed code. A person share becomes active and its
	 * recipient is emailed the link; a verify link becomes active and its proposer may then reveal the token once.
	 */
	async consentShare(
		session: ActiveSession,
		grantId: unknown,
		options: { code?: string } = {},
	): Promise<Outcome<{ status: GrantStatus; mailed: boolean | null }>> {
		const denied = await this.gate(session, "act");
		if (denied) return denied;
		if (typeof grantId !== "string" || grantId === "")
			return failure("bad_request", "Say which share you are answering.");
		let expiresAt = "";
		const result = await this.commit(
			session,
			"visibility.changed",
			async ({ loaded }) => {
				const grant = this.grantsNow(loaded).find(
					(candidate) => candidate.grant_id === grantId,
				);
				if (grant === undefined) return failure("not_found", "No such share.");
				if (grant.status !== "pending")
					return failure("rejected", "That share is not waiting for a reply.");
				if (grant.consented_by.includes(session.role))
					return failure("rejected", "Your side already agreed to this share.");
				expiresAt = grant.expires_at;
				return { payload: { change: "grant.consented", grant_id: grantId } };
			},
			{ code: options.code, action: SHARE_CONSENT_ACTION },
		);
		if (!result.ok) return result;
		const share = await this.deps.store.getShare(session.noteId, grantId);
		if (share?.kind !== "person" || share.recipientEmail === null)
			return { ok: true, status: "active", mailed: null };
		const mailed = await this.sendShareLink(
			session.noteId,
			grantId,
			share.recipientEmail,
			expiresAt,
			false,
		);
		return { ok: true, status: "active", mailed };
	}

	/** Either party ends a share at any time. The next request of its viewer is refused. */
	async revokeShare(
		session: ActiveSession,
		grantId: unknown,
	): Promise<Outcome<Record<never, never>>> {
		const denied = await this.gate(session, "act");
		if (denied) return denied;
		if (typeof grantId !== "string" || grantId === "")
			return failure("bad_request", "Say which share to end.");
		const result = await this.commit(
			session,
			"visibility.changed",
			async ({ loaded }) => {
				const grant = this.grantsNow(loaded).find(
					(candidate) => candidate.grant_id === grantId,
				);
				if (grant === undefined) return failure("not_found", "No such share.");
				if (grant.status === "revoked" || grant.status === "expired")
					return failure("rejected", "That share has already ended.");
				return { payload: { change: "grant.revoked", grant_id: grantId } };
			},
		);
		return result.ok ? { ok: true } : result;
	}

	/** The shares of this note and its disclosure log, the same rows for both parties. */
	async listShares(
		session: ActiveSession,
	): Promise<Outcome<{ sharing: SharingView }>> {
		const viewed = await this.view(session);
		return viewed.ok ? { ok: true, sharing: viewed.view.sharing } : viewed;
	}

	/**
	 * Shows the proposer of an active verify link its token, once. The token is made here and only its hash is kept, so
	 * a second call, or a lost token, cannot show it again: end the link and make another.
	 */
	async revealVerifyLink(
		session: ActiveSession,
		grantId: unknown,
	): Promise<Outcome<{ token: string; url: string; expiresAt: string }>> {
		const denied = await this.gate(session, "act");
		if (denied) return denied;
		if (typeof grantId !== "string" || grantId === "")
			return failure("bad_request", "Say which link to show.");
		const loaded = await this.loadVerified(session.noteId);
		if (!loaded.ok) return loaded;
		const grant = this.grantsNow(loaded).find(
			(candidate) => candidate.grant_id === grantId,
		);
		if (
			grant === undefined ||
			grant.audience.kind !== "link" ||
			grant.status !== "active" ||
			!isProposer(loaded.events, grant, session.role, session.agent?.agentRef)
		)
			return failure("not_found", "No such link to show.");
		const secret = this.deps.ids.token(SHARE_TOKEN_BYTES);
		const written = await this.deps.store.issueShareLink(
			session.noteId,
			grantId,
			await sha256Hex(secret),
			false,
		);
		if (!written)
			return failure(
				"rejected",
				"This link was shown once already. End it and make a new one.",
			);
		const token = verifyTokenOf(session.noteId, secret);
		return {
			ok: true,
			token,
			url: `${this.deps.baseUrl}/v/${token}`,
			expiresAt: grant.expires_at,
		};
	}

	/** The proposer of an active person share asks for its link to be sent again (the old one stops working). */
	async resendShare(
		session: ActiveSession,
		grantId: unknown,
	): Promise<Outcome<Record<never, never>>> {
		const denied = await this.gate(session, "act");
		if (denied) return denied;
		if (typeof grantId !== "string" || grantId === "")
			return failure("bad_request", "Say which share to send again.");
		const loaded = await this.loadVerified(session.noteId);
		if (!loaded.ok) return loaded;
		const grant = this.grantsNow(loaded).find(
			(candidate) => candidate.grant_id === grantId,
		);
		const share = await this.deps.store.getShare(session.noteId, grantId);
		if (
			grant === undefined ||
			grant.audience.kind !== "person" ||
			grant.status !== "active" ||
			share?.recipientEmail === null ||
			share === null ||
			!isProposer(loaded.events, grant, session.role, session.agent?.agentRef)
		)
			return failure("not_found", "No such share to send again.");
		const allowed = await this.deps.store.hit(
			session.noteId,
			"share-resend",
			this.deps.clock.now(),
			SHARE_WINDOW_MS,
			SHARE_RESENDS_PER_DAY,
		);
		if (!allowed)
			return failure(
				"rate_limited",
				"Too many resends today. Try again tomorrow.",
			);
		const mailed = await this.sendShareLink(
			session.noteId,
			grantId,
			share.recipientEmail as string,
			grant.expires_at,
			true,
		);
		return mailed === true
			? { ok: true }
			: failure("mail_failed", "The link could not be sent. Try again later.");
	}

	private stateOf(events: NoteEvent[]): Statement["state"] {
		const created = events[0];
		if (created?.type !== "note.created")
			throw new Error("log has no note.created");
		return statement(events, this.asOf(created.terms.issue_date)).state;
	}
}
