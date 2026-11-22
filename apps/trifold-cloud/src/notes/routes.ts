import type { CloudEnv } from "../env";
import { RemoteNoteStore } from "./do-store";
import {
	type DocumentSigners,
	documentSignersFromEnv,
} from "./documents-service";
import {
	apiError,
	download,
	failureResponse,
	forbiddenPage,
	json,
	NO_STORE,
	notFound,
	page,
	readForm,
	readJson,
	redirect,
	STATUS_OF,
	sameOrigin,
} from "./http";
import { D1OrgStore } from "./org-d1-store";
import { orgNoteSession, orgRoute, ownsOrgPath } from "./org-routes";
import { OrgService } from "./org-service";
import type { OrgStore } from "./org-store";
import {
	codePage,
	documentPage,
	enterPage,
	FLASH_MESSAGES,
	invalidLinkPage,
	linkRequestedPage,
	messagePage,
	NOTES_CSS,
	NOTES_STYLESHEET_PATH,
	type Notice,
	notePage,
	parseAmount,
	signInRequiredPage,
} from "./pages";
import {
	type Clock,
	cryptoIdSource,
	type IdSource,
	type MailSender,
	type PublicKeySource,
	systemClock,
	unconfiguredMailer,
} from "./ports";
import {
	type Failure,
	isStepUpAction,
	type LenderInput,
	NoteService,
	type NoteServiceDeps,
	SHARE_CONSENT_ACTION,
} from "./service";
import {
	type ActiveSession,
	basePathOf,
	clearedSessionCookie,
	constantTimeEqual,
	type GetSession,
	readSessionCookie,
	sessionCookie,
} from "./sessions";
import { publicKeysFromEnv, ShareAccess } from "./share-access";
import { sharingPanel, verifyLinkRevealPage } from "./share-pages";
import {
	ownsSharePath,
	shareCookieRefusal,
	shareRoute,
	verifyRoute,
} from "./share-routes";
import type { NoteStore } from "./store";

/**
 * The guest flow's HTTP surface (docs/specs/promissory-notes.md build step 2). Staging only, like billing: every path
 * this file owns answers 404 unless `ENVIRONMENT` is `staging`.
 *
 * | Host | Route | Auth |
 * |---|---|---|
 * | ledger | `GET /n/assets/notes.css` | none |
 * | ledger | `GET /n/:id/enter?t=` | none; shows a button, redeems nothing |
 * | ledger | `POST /n/:id/enter` | the link token in the form |
 * | ledger | `POST /n/:id/link` | none; same answer for any address |
 * | ledger | `GET /n/:id` | session cookie |
 * | ledger | `POST /n/:id/act`, `POST /n/:id/code` | session cookie and CSRF token |
 * | ledger | `POST /n/:id/receipt` | session cookie and CSRF token, either party |
 * | ledger | `POST /n/:id/payoff`, `/release`, `/notice` | session cookie and CSRF token, lender only |
 * | ledger | `GET /n/:id/docs/:docId` and `.json` | session cookie, either party |
 * | ledger | `GET /n/:id/bundle.json`, `GET /n/:id/seal.json` | session cookie, either party |
 * | api | `POST /v1/notes` | bearer `NOTES_API_KEY` |
 * | api | `GET /v1/notes/:id/statement?as_of=` | bearer `NOTES_API_KEY` |
 * | api | `GET /v1/notes/:id/bundle`, `GET /v1/notes/:id/seal` | bearer `NOTES_API_KEY` |
 * | api | `POST /v1/notes/:id/agents` | bearer `NOTES_API_KEY`: add or deactivate an organization agent |
 * | api | `GET /v1/orgs/:orgId/portfolio?as_of=` | bearer `NOTES_API_KEY` |
 * | ledger | `POST /n/:id/share/propose`, `/consent`, `/revoke`, `/verify-link`, `/reveal`, `/resend` | session cookie and CSRF token; `/consent` also needs the emailed code; same under `/o/:orgId/n/:id` for a treasurer or board member |
 * | ledger | `GET /s/:noteId/:grantId/enter`, `POST` (redeem), `GET /s/:noteId/:grantId`, `GET` and `POST /v/:token` | see `share-routes.ts` |
 * | ledger | `/o/:orgId/n/:id` and its steps, `docs`, `bundle.json`, `seal.json` | organization session (see `org-routes.ts` for `/o/:orgId`) |
 */

export interface NotesDeps {
	store?: NoteStore;
	mailer?: MailSender;
	clock?: Clock;
	ids?: IdSource;
	/** Test signers. Absent: the Worker's keys (`documentSignersFromEnv`). `null`: no signing is set up. */
	signers?: DocumentSigners | null;
	options?: NoteServiceDeps["options"];
	/** The organization store. Absent: D1 (`DB`, migration 0003). */
	orgs?: OrgStore;
	/** The published public keys for the verify link's document check. Absent: `NOTES_PUBLIC_KEYS_JSON`. */
	publicKeys?: PublicKeySource;
}

const NOTE_ID = "[A-Za-z0-9_-]{8,80}";
const SHARE_STEPS =
	"share/(?:propose|consent|revoke|verify-link|reveal|resend)";
const GUEST_PATH = new RegExp(
	`^/n/(${NOTE_ID})(?:/(enter|link|act|code|receipt|payoff|release|notice|${SHARE_STEPS}))?/?$`,
);
const DOCUMENT_PATH = new RegExp(
	`^/n/(${NOTE_ID})/docs/([A-Za-z0-9_-]{1,80})(\\.json)?/?$`,
);
const FILE_PATH = new RegExp(`^/n/(${NOTE_ID})/(bundle|seal)\\.json$`);
const API_NOTE_PATH = new RegExp(
	`^/v1/notes/(${NOTE_ID})/(statement|bundle|seal)/?$`,
);
const API_AGENTS_PATH = new RegExp(`^/v1/notes/(${NOTE_ID})/agents/?$`);
const API_PORTFOLIO_PATH = /^\/v1\/orgs\/([A-Za-z0-9_-]{1,64})\/portfolio\/?$/;
const ORG_NOTE_PATH = new RegExp(
	`^/o/([A-Za-z0-9_-]{1,64})/n/(${NOTE_ID})(?:/(act|code|receipt|payoff|release|notice|request|approve|${SHARE_STEPS}))?/?$`,
);
const ORG_DOCUMENT_PATH = new RegExp(
	`^/o/([A-Za-z0-9_-]{1,64})/n/(${NOTE_ID})/docs/([A-Za-z0-9_-]{1,80})(\\.json)?/?$`,
);
const ORG_FILE_PATH = new RegExp(
	`^/o/([A-Za-z0-9_-]{1,64})/n/(${NOTE_ID})/(bundle|seal)\\.json$`,
);
const CURE_DAYS = /^\d{1,3}$/;
const BEARER = /^Bearer (.+)$/;
const FORM_FIELD_EXCLUDED = new Set(["csrf", "code", "type"]);

type Surface = "ledger" | "api";

const surfaceOf = (hostname: string, env: CloudEnv): Surface | null => {
	if (hostname === env.LEDGER_HOST) return "ledger";
	if (hostname === env.API_HOST) return "api";
	return null;
};

interface Services {
	service: NoteService;
	org: OrgService;
	access: ShareAccess;
}

/** The services for this request, or null when `NOTES_SESSION_SECRET` is not set (the feature answers 503). */
const serviceFor = (
	env: CloudEnv,
	url: URL,
	deps: NotesDeps,
): Services | null => {
	if (!env.NOTES_SESSION_SECRET) return null;
	const store = deps.store ?? new RemoteNoteStore(env.NOTE);
	const mailer = deps.mailer ?? unconfiguredMailer;
	const clock = deps.clock ?? systemClock;
	const ids = deps.ids ?? cryptoIdSource;
	const secret = env.NOTES_SESSION_SECRET;
	const baseUrl = `https://${url.host}`;
	const org = new OrgService({
		orgs: deps.orgs ?? new D1OrgStore(env.DB),
		store,
		mailer,
		clock,
		ids,
		secret,
		baseUrl,
	});
	const service = new NoteService({
		store,
		mailer,
		clock,
		ids,
		secret,
		baseUrl,
		org,
		signers:
			deps.signers === undefined ? documentSignersFromEnv(env) : deps.signers,
		...(deps.options ? { options: deps.options } : {}),
	});
	const access = new ShareAccess({
		store,
		clock,
		ids,
		keys: deps.publicKeys ?? publicKeysFromEnv(env),
	});
	return { service, org, access };
};

const notConfigured = (surface: Surface): Response =>
	surface === "api"
		? apiError(503, "not_configured", "Notes are not set up here yet.")
		: page(
				messagePage("Not available", "This service is not set up yet."),
				503,
			);

const sessionOf = async (
	service: NoteService,
	request: Request,
	noteId: string,
): Promise<ActiveSession | null> =>
	service.sessions.resolve(
		noteId,
		readSessionCookie(request.headers.get("Cookie")),
	);

const guestSession =
	(service: NoteService, noteId: string): GetSession =>
	async (request, clear) =>
		(await sessionOf(service, request, noteId)) ??
		page(
			signInRequiredPage(noteId),
			401,
			clear ? { "Set-Cookie": clearedSessionCookie(noteId) } : {},
		);

/** Turns what a form sent into an event input: decimal amounts become minor units with the note's exponent. */
const eventInput = (
	type: string,
	fields: Record<string, string>,
	exponent: number,
): { input: Record<string, unknown> } | { error: string } => {
	const input: Record<string, unknown> = { ...fields, type };
	const convert = (from: string, to: string): string | null => {
		const text = input[from];
		if (typeof text !== "string") return null;
		delete input[from];
		const minor = parseAmount(text, exponent);
		if (minor === null)
			return `Enter an amount like 350${exponent > 0 ? `.${"0".repeat(exponent)}` : ""}.`;
		input[to] = minor;
		return null;
	};
	const conversions: Record<string, [string, string]> = {
		"payment.recorded": ["amount", "amount_minor"],
		"payment.disputed": ["counter_amount", "counter_amount_minor"],
		"payment.resolved": ["agreed_amount", "agreed_amount_minor"],
	};
	const conversion = conversions[type];
	if (conversion) {
		const problem = convert(conversion[0], conversion[1]);
		if (problem !== null) return { error: problem };
	}
	return { input };
};

const carryFields = (
	fields: Record<string, string>,
): Record<string, string> => {
	const carried: Record<string, string> = {};
	for (const [name, value] of Object.entries(fields)) {
		if (!FORM_FIELD_EXCLUDED.has(name)) carried[name] = value;
	}
	return carried;
};

/** What the note page answers when the record cannot be shown: a failed record check, or no such note. */
const viewFailure = (failure: Failure): Response =>
	failure.error === "chain_invalid"
		? page(messagePage("Record check failed", failure.message), 409)
		: page(messagePage("Not found", failure.message), 404);

/** The note page for this session, with a notice and a status (after a refused action). */
const noteResponse = async (
	service: NoteService,
	session: ActiveSession,
	notice?: Notice,
	status = 200,
): Promise<Response> => {
	const outcome = await service.view(session);
	if (!outcome.ok) return viewFailure(outcome);
	const { view } = outcome;
	const csrf = await service.sessions.csrfToken(session);
	const sharing = sharingPanel(view.sharing, {
		basePath: view.basePath,
		csrf,
		lenderIsOrg: view.lenderIsOrg,
	});
	return page(notePage(view, csrf, notice, sharing), status);
};

const handleEnter = async (
	request: Request,
	url: URL,
	service: NoteService,
	noteId: string,
): Promise<Response | null> => {
	if (request.method === "GET")
		return page(enterPage(noteId, url.searchParams.get("t")));
	if (request.method !== "POST") return null;
	if (!sameOrigin(request, url))
		return forbiddenPage("That request came from another site.");
	const form = await readForm(request);
	const token = form?.t;
	if (!token) return page(invalidLinkPage(noteId), 400);
	const opened = await service.sessions.redeem(noteId, token);
	if (opened === null) return page(invalidLinkPage(noteId), 400);
	// The target holds no token; the token was in the body, and the cookie is HttpOnly and scoped to this note.
	return redirect(
		`/n/${noteId}?m=entered`,
		sessionCookie(noteId, opened.cookieValue, opened.maxAgeSeconds),
	);
};

const handleLink = async (
	request: Request,
	url: URL,
	service: NoteService,
	noteId: string,
): Promise<Response | null> => {
	if (request.method !== "POST") return null;
	if (!sameOrigin(request, url))
		return forbiddenPage("That request came from another site.");
	const form = await readForm(request);
	await service.requestLink(noteId, form?.email ?? "");
	return page(linkRequestedPage());
};

const handleNote = async (
	request: Request,
	url: URL,
	service: NoteService,
	getSession: GetSession,
): Promise<Response | null> => {
	if (request.method !== "GET") return null;
	const session = await getSession(request, true);
	if (session instanceof Response) return session;
	const flash = url.searchParams.get("m");
	const text =
		flash !== null && Object.hasOwn(FLASH_MESSAGES, flash)
			? FLASH_MESSAGES[flash]
			: undefined;
	return noteResponse(
		service,
		session,
		text === undefined ? undefined : { kind: "ok", text },
	);
};

/** Opens a signed-in POST: the session, the form and the CSRF token, or the response that refuses it. */
const guardedPost = async (
	request: Request,
	url: URL,
	service: NoteService,
	getSession: GetSession,
): Promise<
	| { session: ActiveSession; fields: Record<string, string> }
	| { refusal: Response }
> => {
	if (!sameOrigin(request, url))
		return { refusal: forbiddenPage("That request came from another site.") };
	const session = await getSession(request, false);
	if (session instanceof Response) return { refusal: session };
	const fields = await readForm(request);
	if (fields === null)
		return {
			refusal: page(
				messagePage("Not accepted", "That form could not be read."),
				400,
			),
		};
	if (!(await service.sessions.checkCsrf(session, fields.csrf ?? null)))
		return {
			refusal: forbiddenPage("That form has expired. Go back and try again."),
		};
	return { session, fields };
};

/**
 * What a refused step answers: the code page when the step needs a code (sending one the first time), the same page
 * with the reason when a code was wrong, otherwise the note page with the reason.
 */
const refusedStep = async (
	service: NoteService,
	session: ActiveSession,
	step: {
		type: string;
		carried: Record<string, string>;
		code: string | undefined;
		submitTo?: string;
	},
	result: Failure,
): Promise<Response> => {
	const { type, carried, code } = step;
	const submit = {
		basePath: basePathOf(session),
		...(step.submitTo === undefined ? {} : { submitTo: step.submitTo }),
	};
	const { noteId } = session;
	const csrf = await service.sessions.csrfToken(session);
	if (result.error === "step_up_required" && code === undefined) {
		const sent = await service.requestStepUp(session, type);
		const notice: Notice = sent.ok
			? { kind: "ok", text: "We emailed you a code." }
			: { kind: "error", text: sent.message };
		return page(
			codePage({ noteId, csrf, type, fields: carried, notice, ...submit }),
			sent.ok ? 200 : STATUS_OF[sent.error],
		);
	}
	if (result.error === "step_up_required" || result.error === "step_up_invalid")
		return page(
			codePage({
				noteId,
				csrf,
				type,
				fields: carried,
				notice: { kind: "error", text: result.message },
				...submit,
			}),
			403,
		);
	return noteResponse(
		service,
		session,
		{ kind: "error", text: result.message },
		STATUS_OF[result.error],
	);
};

const handleAct = async (
	request: Request,
	url: URL,
	service: NoteService,
	getSession: GetSession,
): Promise<Response | null> => {
	if (request.method !== "POST") return null;
	const guarded = await guardedPost(request, url, service, getSession);
	if ("refusal" in guarded) return guarded.refusal;
	const { session, fields } = guarded;
	const type = fields.type ?? "";
	const code = fields.code;
	const carried = carryFields(fields);
	const outcome = await service.view(session);
	if (!outcome.ok) return viewFailure(outcome);
	const built = eventInput(type, carried, outcome.view.terms.exponent);
	if ("error" in built)
		return noteResponse(
			service,
			session,
			{ kind: "error", text: built.error },
			422,
		);
	const result = await service.append(
		session,
		built.input,
		code === undefined ? {} : { code },
	);
	if (result.ok) return redirect(`${basePathOf(session)}?m=recorded`);
	return refusedStep(service, session, { type, carried, code }, result);
};

/** The path under the note's page each step-up action posts to: the generic one, or the lender's own route. */
const submitPathOf = (type: string): string =>
	type === "release.confirmed"
		? "release"
		: type === "notice.sent"
			? "notice"
			: type === SHARE_CONSENT_ACTION
				? "share/consent"
				: "act";

const handleCode = async (
	request: Request,
	url: URL,
	service: NoteService,
	getSession: GetSession,
): Promise<Response | null> => {
	if (request.method !== "POST") return null;
	const guarded = await guardedPost(request, url, service, getSession);
	if ("refusal" in guarded) return guarded.refusal;
	const { session, fields } = guarded;
	const type = fields.type ?? "";
	if (!isStepUpAction(type))
		return noteResponse(
			service,
			session,
			{ kind: "error", text: "That step does not need a code." },
			400,
		);
	const sent = await service.requestStepUp(session, type);
	const notice: Notice = sent.ok
		? { kind: "ok", text: "We emailed you a new code." }
		: { kind: "error", text: sent.message };
	return page(
		codePage({
			noteId: session.noteId,
			basePath: basePathOf(session),
			csrf: await service.sessions.csrfToken(session),
			type,
			fields: carryFields(fields),
			notice,
			submitTo: submitPathOf(type),
		}),
		sent.ok ? 200 : STATUS_OF[sent.error],
	);
};

/** Where a lender step goes on success: the page to redirect to. */
type StepOutcome = { ok: true; location: string } | Failure;

type LenderForm = {
	/** The action a step-up code is bound to; null when the route never asks for one. */
	type: string;
	submitTo: string;
	run: (
		service: NoteService,
		session: ActiveSession,
		fields: Record<string, string>,
		code: string | undefined,
	) => Promise<StepOutcome>;
};

const cureDaysOf = (text: string | undefined): number | undefined => {
	const trimmed = (text ?? "").trim();
	if (trimmed === "") return undefined;
	return CURE_DAYS.test(trimmed) ? Number(trimmed) : Number.NaN;
};

const LENDER_FORMS: Record<"payoff" | "release" | "notice", LenderForm> = {
	payoff: {
		type: "payoff.issued",
		submitTo: "payoff",
		run: async (service, session, fields) => {
			const issued = await service.issuePayoff(session, fields.as_of?.trim());
			return issued.ok
				? {
						ok: true,
						location: `${basePathOf(session)}/docs/${issued.document.id}`,
					}
				: issued;
		},
	},
	release: {
		type: "release.confirmed",
		submitTo: "release",
		run: async (service, session, fields, code) => {
			const done =
				fields.step === "draft"
					? await service.draftRelease(session)
					: await service.confirmRelease(
							session,
							fields.target,
							code === undefined ? {} : { code },
						);
			if (!done.ok) return done;
			const flash =
				fields.step === "draft" ? "release_drafted" : "release_confirmed";
			return { ok: true, location: `${basePathOf(session)}?m=${flash}` };
		},
	},
	notice: {
		type: "notice.sent",
		submitTo: "notice",
		run: async (service, session, fields, code) => {
			const cure = cureDaysOf(fields.cure_days);
			const sent = await service.sendNotice(
				session,
				cure === undefined
					? { kind: fields.kind }
					: { kind: fields.kind, cure_days: cure },
				code === undefined ? {} : { code },
			);
			if (!sent.ok) return sent;
			const flash = sent.mailed ? "notice_sent" : "notice_unmailed";
			return { ok: true, location: `${basePathOf(session)}?m=${flash}` };
		},
	},
};

const handleLenderForm = async (
	request: Request,
	url: URL,
	service: NoteService,
	getSession: GetSession,
	form: LenderForm,
): Promise<Response | null> => {
	if (request.method !== "POST") return null;
	const guarded = await guardedPost(request, url, service, getSession);
	if ("refusal" in guarded) return guarded.refusal;
	const { session, fields } = guarded;
	const code = fields.code;
	const result = await form.run(service, session, fields, code);
	if (result.ok) return redirect(result.location);
	return refusedStep(
		service,
		session,
		{
			type: form.type,
			carried: carryFields(fields),
			code,
			submitTo: form.submitTo,
		},
		result,
	);
};

const handleReceipt = async (
	request: Request,
	url: URL,
	service: NoteService,
	getSession: GetSession,
): Promise<Response | null> => {
	if (request.method !== "POST") return null;
	const guarded = await guardedPost(request, url, service, getSession);
	if ("refusal" in guarded) return guarded.refusal;
	const { session, fields } = guarded;
	const issued = await service.issueReceipt(session, fields.event);
	if (!issued.ok)
		return noteResponse(
			service,
			session,
			{ kind: "error", text: issued.message },
			STATUS_OF[issued.error],
		);
	return redirect(`${basePathOf(session)}/docs/${issued.document.id}`);
};

/** Ask for an approval, or approve one. Only an organization lender has either; a guest session is refused by the service. */
const handleApproval = async (
	request: Request,
	url: URL,
	service: NoteService,
	getSession: GetSession,
	kind: "request" | "approve",
): Promise<Response | null> => {
	if (request.method !== "POST") return null;
	const guarded = await guardedPost(request, url, service, getSession);
	if ("refusal" in guarded) return guarded.refusal;
	const { session, fields } = guarded;
	const result =
		kind === "request"
			? await service.requestApproval(session, {
					action: fields.action,
					target: fields.target,
				})
			: await service.grantApproval(session, fields.request_id);
	if (result.ok)
		return redirect(
			`${basePathOf(session)}?m=${kind === "request" ? "approval_requested" : "approval_granted"}`,
		);
	return noteResponse(
		service,
		session,
		{ kind: "error", text: result.message },
		STATUS_OF[result.error],
	);
};

const DAYS_TEXT = /^\d{1,4}$/;

/** Whole days typed in a form: none means the default, anything that is not digits is refused by the service. */
const daysOf = (text: string | undefined): number | undefined => {
	const trimmed = (text ?? "").trim();
	if (trimmed === "") return undefined;
	return DAYS_TEXT.test(trimmed) ? Number(trimmed) : Number.NaN;
};

type ShareStep = "propose" | "consent" | "revoke" | "verify-link" | "resend";

const shareDone = (session: ActiveSession, flash: string): StepOutcome => ({
	ok: true,
	location: `${basePathOf(session)}?m=${flash}`,
});

/** The sharing steps a party presses. Only consent needs the emailed code; every refusal shows on the note page. */
const SHARE_FORMS: Record<ShareStep, LenderForm> = {
	propose: {
		type: "visibility.changed",
		submitTo: "share/propose",
		run: async (service, session, fields) => {
			const days = daysOf(fields.days);
			const proposed = await service.proposeShare(session, {
				recipient_email: fields.recipient_email,
				level: fields.level,
				...(days === undefined ? {} : { days }),
				...(fields.carve_out === "1"
					? { carve_out: { purpose: fields.purpose } }
					: {}),
			});
			if (!proposed.ok) return proposed;
			if (proposed.status === "pending")
				return shareDone(session, "share_proposed");
			return shareDone(
				session,
				proposed.mailed === false ? "share_unmailed" : "share_disclosed",
			);
		},
	},
	consent: {
		type: SHARE_CONSENT_ACTION,
		submitTo: "share/consent",
		run: async (service, session, fields, code) => {
			const done = await service.consentShare(
				session,
				fields.grant_id,
				code === undefined ? {} : { code },
			);
			if (!done.ok) return done;
			return shareDone(
				session,
				done.mailed === false ? "share_unmailed" : "share_consented",
			);
		},
	},
	revoke: {
		type: "visibility.changed",
		submitTo: "share/revoke",
		run: async (service, session, fields) => {
			const done = await service.revokeShare(session, fields.grant_id);
			return done.ok ? shareDone(session, "share_revoked") : done;
		},
	},
	"verify-link": {
		type: "visibility.changed",
		submitTo: "share/verify-link",
		run: async (service, session, fields) => {
			const days = daysOf(fields.days);
			const made = await service.createVerifyLink(
				session,
				days === undefined ? {} : { days },
			);
			return made.ok ? shareDone(session, "share_link_proposed") : made;
		},
	},
	resend: {
		type: "visibility.changed",
		submitTo: "share/resend",
		run: async (service, session, fields) => {
			const done = await service.resendShare(session, fields.grant_id);
			return done.ok ? shareDone(session, "share_resent") : done;
		},
	},
};

/** The proposer of an active verify link sees its token once, in a page the browser must not keep. */
const handleReveal = async (
	request: Request,
	url: URL,
	service: NoteService,
	getSession: GetSession,
): Promise<Response | null> => {
	if (request.method !== "POST") return null;
	const guarded = await guardedPost(request, url, service, getSession);
	if ("refusal" in guarded) return guarded.refusal;
	const { session, fields } = guarded;
	const shown = await service.revealVerifyLink(session, fields.grant_id);
	if (!shown.ok)
		return noteResponse(
			service,
			session,
			{ kind: "error", text: shown.message },
			STATUS_OF[shown.error],
		);
	return page(
		verifyLinkRevealPage(shown.url, shown.expiresAt, basePathOf(session)),
	);
};

const SHARE_STEP_NAMES = new Set<string>([
	"propose",
	"consent",
	"revoke",
	"verify-link",
	"resend",
]);

const isShareStep = (name: string): name is ShareStep =>
	SHARE_STEP_NAMES.has(name);

/** The note steps both a guest and an organization agent reach; `action` is the path segment after the note. */
export const noteStepRoute = async (
	request: Request,
	url: URL,
	service: NoteService,
	getSession: GetSession,
	action: string | undefined,
): Promise<Response | null> => {
	switch (action) {
		case "act":
			return handleAct(request, url, service, getSession);
		case "code":
			return handleCode(request, url, service, getSession);
		case "receipt":
			return handleReceipt(request, url, service, getSession);
		case "request":
		case "approve":
			return handleApproval(request, url, service, getSession, action);
		case "payoff":
		case "release":
		case "notice":
			return handleLenderForm(
				request,
				url,
				service,
				getSession,
				LENDER_FORMS[action],
			);
		default:
			return shareStepRoute(request, url, service, getSession, action);
	}
};

/** `share/<step>` under a note, or the note page itself when `action` is none. */
const shareStepRoute = (
	request: Request,
	url: URL,
	service: NoteService,
	getSession: GetSession,
	action: string | undefined,
): Promise<Response | null> => {
	const step = action?.startsWith("share/")
		? action.slice("share/".length)
		: "";
	if (step === "reveal") return handleReveal(request, url, service, getSession);
	if (isShareStep(step))
		return handleLenderForm(
			request,
			url,
			service,
			getSession,
			SHARE_FORMS[step],
		);
	return handleNote(request, url, service, getSession);
};

const guestRoute = async (
	request: Request,
	url: URL,
	service: NoteService,
	noteId: string,
	action: string | undefined,
): Promise<Response | null> => {
	switch (action) {
		case "enter":
			return handleEnter(request, url, service, noteId);
		case "link":
			return handleLink(request, url, service, noteId);
		default:
			return noteStepRoute(
				request,
				url,
				service,
				guestSession(service, noteId),
				action,
			);
	}
};

const handleDocument = async (
	request: Request,
	service: NoteService,
	getSession: GetSession,
	docId: string,
	asJson: boolean,
): Promise<Response | null> => {
	if (request.method !== "GET") return null;
	const session = await getSession(request, true);
	if (session instanceof Response) return session;
	const found = await service.document(session, docId);
	if (!found.ok) return page(messagePage("Not found", found.message), 404);
	if (asJson)
		return download(
			found.document.json,
			`${found.document.type}-${docId}.json`,
		);
	return page(
		documentPage(session.noteId, docId, found.signed, basePathOf(session)),
	);
};

const handleFile = async (
	request: Request,
	service: NoteService,
	getSession: GetSession,
	file: string,
): Promise<Response | null> => {
	if (request.method !== "GET") return null;
	const session = await getSession(request, true);
	if (session instanceof Response) return session;
	const { noteId } = session;
	if (file === "bundle") {
		const made = await service.bundle(session);
		if (!made.ok) return failureResponse(made);
		return download(JSON.stringify(made.bundle), `note-${noteId}-bundle.json`);
	}
	const sealed = await service.sealChain(noteId);
	if (!sealed.ok) return failureResponse(sealed);
	return download(sealed.seal.json, `note-${noteId}-seal.json`);
};

/** True when the request carries the configured API key as a bearer token. The compare is constant-time. */
export const hasApiKey = (request: Request, env: CloudEnv): boolean => {
	const expected = env.NOTES_API_KEY;
	if (!expected) return false;
	const supplied = BEARER.exec(request.headers.get("Authorization") ?? "")?.[1];
	return supplied !== undefined && constantTimeEqual(supplied, expected);
};

const createRoute = async (
	request: Request,
	service: NoteService,
): Promise<Response> => {
	const body = await readJson(request);
	if (typeof body !== "object" || body === null || Array.isArray(body))
		return apiError(400, "bad_request", "Send a JSON object.");
	const {
		terms,
		lender_email: lenderEmail,
		lender_org: lenderOrg,
		borrower_email: borrower,
		idem,
	} = body as Record<string, unknown>;
	const lender = lenderOf(lenderEmail, lenderOrg);
	if (
		lender === null ||
		typeof borrower !== "string" ||
		typeof idem !== "string"
	)
		return apiError(
			400,
			"bad_request",
			"Send { terms, borrower_email, idem } and either lender_email or lender_org: { org_id, agents: [{ email, role }] }.",
		);
	const result = await service.createNote({
		terms,
		lender,
		borrower: { email: borrower },
		idem,
	});
	if (!result.ok) return failureResponse(result);
	return json(
		{
			note_id: result.noteId,
			...(result.agents
				? {
						agents: result.agents.map((agent) => ({
							agent_ref: agent.agentRef,
							role: agent.role,
							active: agent.active,
						})),
					}
				: {}),
		},
		result.created ? 201 : 200,
	);
};

/** The lender a create request names: exactly one of a person's address or an organization with its agents. */
const lenderOf = (email: unknown, org: unknown): LenderInput | null => {
	if (typeof email === "string" && org === undefined) return { email };
	if (email !== undefined || typeof org !== "object" || org === null)
		return null;
	const { org_id: orgId, agents } = org as Record<string, unknown>;
	return { org_id: typeof orgId === "string" ? orgId : "", agents };
};

/** `POST /v1/notes/:id/agents`: add an agent, or deactivate one by ref or address. */
const agentsRoute = async (
	request: Request,
	noteId: string,
	org: OrgService,
): Promise<Response> => {
	const body = await readJson(request);
	if (typeof body !== "object" || body === null || Array.isArray(body))
		return apiError(400, "bad_request", "Send a JSON object.");
	const {
		action,
		email,
		role,
		agent_ref: agentRef,
	} = body as Record<string, unknown>;
	if (action === "add") {
		if (typeof email !== "string" || typeof role !== "string")
			return apiError(
				400,
				"bad_request",
				'Send { action: "add", email, role }.',
			);
		const added = await org.addAgent(noteId, { email, role });
		return added.ok
			? json({ agent_ref: added.agentRef, role: added.role, active: true })
			: failureResponse(added);
	}
	if (action === "deactivate") {
		const who =
			typeof agentRef === "string"
				? { agentRef }
				: typeof email === "string"
					? { email }
					: null;
		if (who === null)
			return apiError(
				400,
				"bad_request",
				'Send { action: "deactivate", agent_ref } or { action: "deactivate", email }.',
			);
		const done = await org.deactivateAgent(noteId, who);
		return done.ok
			? json({ agent_ref: done.agentRef, active: false })
			: failureResponse(done);
	}
	return apiError(400, "bad_request", 'The action is "add" or "deactivate".');
};

/** `GET /v1/orgs/:orgId/portfolio`: the portfolio JSON and the approvals waiting. No agent ref and no event id. */
const portfolioRoute = async (
	url: URL,
	orgId: string,
	org: OrgService,
): Promise<Response> => {
	if (!(await org.exists(orgId))) return notFound();
	const result = await org.portfolio(
		orgId,
		url.searchParams.get("as_of") ?? undefined,
	);
	if (!result.ok) return failureResponse(result);
	return json({
		org_id: orgId,
		as_of: result.asOf,
		portfolio: result.portfolio,
		approvals: result.queue.map((item) => ({
			note_id: item.noteId,
			action: item.action,
			requested_at: item.requestedAt,
		})),
	});
};

const unauthorized = (): Response =>
	json(
		{
			error: {
				code: "unauthorized",
				message: "Send the API key as a bearer token.",
			},
		},
		401,
		{ "WWW-Authenticate": "Bearer" },
	);

const apiRoute = async (
	request: Request,
	url: URL,
	env: CloudEnv,
	services: Services,
): Promise<Response | null> => {
	const { service, org } = services;
	const matched = API_NOTE_PATH.exec(url.pathname);
	const agents = API_AGENTS_PATH.exec(url.pathname);
	const portfolioMatch = API_PORTFOLIO_PATH.exec(url.pathname);
	const isCreate = url.pathname === "/v1/notes" && request.method === "POST";
	const isAgents = agents !== null && request.method === "POST";
	const isPortfolio = portfolioMatch !== null && request.method === "GET";
	if (
		!(
			isCreate ||
			isAgents ||
			isPortfolio ||
			(matched !== null && request.method === "GET")
		)
	)
		return null;
	if (!hasApiKey(request, env)) return unauthorized();
	if (isCreate) return createRoute(request, service);
	if (isAgents) return agentsRoute(request, agents[1] as string, org);
	if (isPortfolio) return portfolioRoute(url, portfolioMatch[1] as string, org);
	const noteId = matched?.[1] as string;
	if (matched?.[2] === "bundle") {
		const made = await service.bundleOf(noteId);
		return made.ok ? json(made.bundle) : failureResponse(made);
	}
	if (matched?.[2] === "seal") {
		const sealed = await service.sealChain(noteId);
		return sealed.ok
			? json(JSON.parse(sealed.seal.json) as unknown)
			: failureResponse(sealed);
	}
	const asOf = url.searchParams.get("as_of") ?? undefined;
	const result = await service.statementFor(noteId, asOf);
	if (!result.ok) return failureResponse(result);
	return json({
		note_id: noteId,
		statement: result.statement,
		chain: result.chain,
	});
};

const ownsApiPath = (url: URL): boolean =>
	url.pathname === "/v1/notes" ||
	API_NOTE_PATH.test(url.pathname) ||
	API_AGENTS_PATH.test(url.pathname) ||
	API_PORTFOLIO_PATH.test(url.pathname);

const ownsLedgerPath = (url: URL): boolean =>
	GUEST_PATH.test(url.pathname) ||
	DOCUMENT_PATH.test(url.pathname) ||
	FILE_PATH.test(url.pathname) ||
	ORG_NOTE_PATH.test(url.pathname) ||
	ORG_DOCUMENT_PATH.test(url.pathname) ||
	ORG_FILE_PATH.test(url.pathname) ||
	ownsOrgPath(url) ||
	ownsSharePath(url) ||
	url.pathname === NOTES_STYLESHEET_PATH;

/**
 * An organization agent's note routes, `/o/:orgId/n/:id...`: the same steps as a guest's, with the agent's organization
 * session. An organization that does not exist answers 404 whether or not anyone is signed in.
 */
const orgNoteRoute = async (
	request: Request,
	url: URL,
	services: Services,
): Promise<Response | null> => {
	const { service, org } = services;
	const document = ORG_DOCUMENT_PATH.exec(url.pathname);
	const file = ORG_FILE_PATH.exec(url.pathname);
	const step = ORG_NOTE_PATH.exec(url.pathname);
	const match = document ?? file ?? step;
	if (match === null) return null;
	const orgId = match[1] as string;
	const noteId = match[2] as string;
	if (!(await org.exists(orgId)))
		return page(messagePage("Not found", "Nothing here."), 404);
	const getSession = orgNoteSession(org, orgId, noteId);
	if (document)
		return handleDocument(
			request,
			service,
			getSession,
			document[3] as string,
			document[4] !== undefined,
		);
	if (file) return handleFile(request, service, getSession, file[3] as string);
	return noteStepRoute(request, url, service, getSession, step?.[3]);
};

/**
 * Answers a request this module owns, or null so the router carries on. Nothing here is served outside staging.
 * `deps` lets tests swap the store, mailer, clock and ids; the Worker passes none (Durable Object store, no mailer
 * until an email provider is chosen, the system clock, WebCrypto ids).
 */
export const notesRoute = async (
	request: Request,
	env: CloudEnv,
	deps: NotesDeps = {},
): Promise<Response | null> => {
	const url = new URL(request.url);
	const surface = surfaceOf(url.hostname, env);
	if (surface === null) return null;
	const owned = surface === "ledger" ? ownsLedgerPath(url) : ownsApiPath(url);
	if (!owned) return null;
	if (env.ENVIRONMENT !== "staging") return notFound();
	if (url.pathname === NOTES_STYLESHEET_PATH) {
		if (request.method !== "GET") return null;
		return new Response(NOTES_CSS, {
			headers: {
				"Content-Type": "text/css; charset=utf-8",
				"Cache-Control": NO_STORE,
			},
		});
	}
	const services = serviceFor(env, url, deps);
	if (services === null) return notConfigured(surface);
	const { service, org, access } = services;
	if (surface === "api") return apiRoute(request, url, env, services);
	if (url.pathname.startsWith("/s/") || url.pathname.startsWith("/v/"))
		return (
			(await shareRoute(request, url, access)) ??
			(await verifyRoute(request, url, access))
		);
	// A share session's cookie is scoped to its own page; one that arrives here anyway opens nothing.
	const refused = shareCookieRefusal(request);
	if (refused) return refused;
	if (url.pathname.startsWith("/o/")) {
		const noteRoute = await orgNoteRoute(request, url, services);
		if (noteRoute) return noteRoute;
		return orgRoute(request, url, org);
	}
	const document = DOCUMENT_PATH.exec(url.pathname);
	if (document)
		return handleDocument(
			request,
			service,
			guestSession(service, document[1] as string),
			document[2] as string,
			document[3] !== undefined,
		);
	const file = FILE_PATH.exec(url.pathname);
	if (file)
		return handleFile(
			request,
			service,
			guestSession(service, file[1] as string),
			file[2] as string,
		);
	const [, noteId, action] = GUEST_PATH.exec(url.pathname) as RegExpExecArray;
	return guestRoute(request, url, service, noteId as string, action);
};
