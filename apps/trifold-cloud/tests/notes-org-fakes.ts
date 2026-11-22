import type { NoteTerms } from "tfd-notes";
import type { DocumentSigners } from "../src/notes/documents-service";
import { MemoryNoteStore } from "../src/notes/memory-store";
import { MemoryOrgStore } from "../src/notes/org-memory-store";
import { OrgService } from "../src/notes/org-service";
import type { OrgSession } from "../src/notes/org-sessions";
import type { OrgStore } from "../src/notes/org-store";
import { NoteService, type Outcome } from "../src/notes/service";
import type { ActiveSession } from "../src/notes/sessions";
import {
	BASE_URL,
	BORROWER_EMAIL,
	DeterministicIds,
	RecordingMailer,
	SECRET,
	SettableClock,
	START,
	TERMS,
} from "./notes-fakes";

export const ORG_ID = "coop-1";
export const TREASURER = "tess@coop.test";
export const BOARD = "bo@coop.test";
export const BOARD_TWO = "bea@coop.test";
export const VIEWER = "vi@coop.test";

export const THREE_AGENTS = [
	{ email: TREASURER, role: "treasurer" },
	{ email: BOARD, role: "board" },
	{ email: VIEWER, role: "viewer" },
];

export const EUR_TERMS: NoteTerms = { ...TERMS, currency: "EUR" };

export const expectOk = <T>(outcome: Outcome<T>): T & { ok: true } => {
	if (!outcome.ok) throw new Error(`${outcome.error}: ${outcome.message}`);
	return outcome;
};

export type Signed = { orgSession: OrgSession; session: ActiveSession };

export type OrgHarness = ReturnType<typeof orgHarness>;

/** Notes with an organization lender, in memory: the services, the stores and the ports they run on. */
export const orgHarness = (
	options: { orgs?: OrgStore; signers?: DocumentSigners | null } = {},
) => {
	const store = new MemoryNoteStore();
	const orgs = options.orgs ?? new MemoryOrgStore();
	const mailer = new RecordingMailer();
	const clock = new SettableClock(START);
	const ids = new DeterministicIds();
	const org = new OrgService({
		orgs,
		store,
		mailer,
		clock,
		ids,
		secret: SECRET,
		baseUrl: BASE_URL,
	});
	const service = new NoteService({
		store,
		mailer,
		clock,
		ids,
		secret: SECRET,
		baseUrl: BASE_URL,
		org,
		...(options.signers === undefined ? {} : { signers: options.signers }),
	});
	const createOrgNote = async (
		input: {
			idem?: string;
			orgId?: string;
			agents?: { email: string; role: string }[];
			terms?: NoteTerms;
			borrower?: string;
		} = {},
	) => {
		const result = expectOk(
			await service.createNote({
				terms: input.terms ?? TERMS,
				lender: {
					org_id: input.orgId ?? ORG_ID,
					agents: input.agents ?? THREE_AGENTS,
				},
				borrower: { email: input.borrower ?? BORROWER_EMAIL },
				idem: input.idem ?? "org-idem-1",
			}),
		);
		return result;
	};
	/** Opens the newest link emailed to `email` as the page does: redeem once, then read the session. */
	const enterAgent = async (
		noteId: string,
		email: string,
		orgId = ORG_ID,
	): Promise<Signed> => {
		const opened = await org.sessions.redeem(orgId, mailer.linkTokenFor(email));
		if (!opened) throw new Error(`link of ${email} did not open`);
		const orgSession = await org.sessions.resolve(orgId, opened.cookieValue);
		if (!orgSession) throw new Error("org session did not resolve");
		const session = await org.noteSession(orgSession, noteId);
		if (!session) throw new Error("note session did not open");
		return { orgSession, session };
	};
	/** Asks for a step-up code and returns the digits emailed to `email`. */
	const codeFor = async (
		session: ActiveSession,
		action: string,
		email: string,
	): Promise<string> => {
		expectOk(await service.requestStepUp(session, action));
		return mailer.codeFor(email);
	};
	/** The agent refs by role, as the create call returned them. */
	const refsOf = (
		agents: { agentRef: string; role: string }[] | undefined,
	): Record<string, string> =>
		Object.fromEntries(
			(agents ?? []).map((agent) => [agent.role, agent.agentRef]),
		);
	return {
		store,
		orgs,
		mailer,
		clock,
		ids,
		org,
		service,
		createOrgNote,
		enterAgent,
		codeFor,
		refsOf,
	};
};
