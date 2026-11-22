import { expect } from "bun:test";
import type { NoteEvent, Role } from "tfd-notes";
import { orgSessionCookieName } from "../src/notes/org-sessions";
import { type NotesDeps, notesRoute } from "../src/notes/routes";
import { type ActiveSession, sessionCookieName } from "../src/notes/sessions";
import { shareCookieName } from "../src/notes/share-routes";
import {
	BORROWER_EMAIL,
	LEDGER,
	LENDER_EMAIL,
	notesEnv,
	TERMS,
} from "./notes-fakes";
import { expectOk, ORG_ID, orgHarness } from "./notes-org-fakes";
import type { TestSigning } from "./notes-signers";

export { orgSessionCookieName, sessionCookieName, shareCookieName };
export const RECIPIENT = "accountant@firm.example";
export const OTHER_RECIPIENT = "lawyer@counsel.example";
export const DAY = 24 * 3_600_000;

/** One signed-in party: the service session, the cookie a browser holds, the page path and its form token. */
export interface Party {
	session: ActiveSession;
	cookie: string;
	cookieName: string;
	/** The note page: `/n/:id` or `/o/:orgId/n/:id`. */
	base: string;
	csrf: string;
	/** The address a step-up code for this party is emailed to. */
	email: string;
}

export type World = ReturnType<typeof shareWorld>;

/** Every notes dependency in memory: guest notes and organization notes share one store, one clock and one mailer. */
export const shareWorld = (
	signing: TestSigning,
	overrides: Partial<NotesDeps> = {},
	envOverrides: Parameters<typeof notesEnv>[0] = {},
) => {
	const h = orgHarness({ signers: signing.signers });
	const env = notesEnv(envOverrides);
	const deps: NotesDeps = {
		store: h.store,
		mailer: h.mailer,
		clock: h.clock,
		ids: h.ids,
		orgs: h.orgs,
		signers: signing.signers,
		publicKeys: { get: async () => signing.keys },
		defer: h.queue.defer,
		...overrides,
	};
	const ledger = async (
		path: string,
		init?: RequestInit,
	): Promise<Response> => {
		const response = await notesRoute(
			new Request(`https://${LEDGER}${path}`, init),
			env,
			deps,
		);
		if (response === null) throw new Error(`not handled: ${path}`);
		// Mail a request deferred is sent after its response, as in the Worker; a test reads the mailbox next.
		await h.flush();
		return response;
	};
	const get = (path: string, cookie?: string) =>
		ledger(path, cookie ? { headers: { Cookie: cookie } } : {});
	const post = (
		path: string,
		fields: Record<string, string>,
		cookie?: string,
	) =>
		ledger(path, {
			method: "POST",
			body: new URLSearchParams(fields),
			headers: cookie ? { Cookie: cookie } : {},
		});

	const openGuest = async (
		noteId: string,
		role: Role,
		email: string,
	): Promise<Party> => {
		const opened = await h.service.sessions.redeem(
			noteId,
			h.mailer.linkTokenFor(email),
		);
		if (!opened) throw new Error(`link of ${email} did not open`);
		const session = await h.service.sessions.resolve(
			noteId,
			opened.cookieValue,
		);
		if (!session) throw new Error("session did not resolve");
		expect(session.role).toBe(role);
		return {
			session,
			cookie: opened.cookieValue,
			cookieName: sessionCookieName(noteId),
			base: `/n/${noteId}`,
			csrf: await h.service.sessions.csrfToken(session),
			email,
		};
	};

	const openAgent = async (
		noteId: string,
		email: string,
		orgId = ORG_ID,
	): Promise<Party> => {
		const opened = await h.org.sessions.redeem(
			orgId,
			h.mailer.linkTokenFor(email),
		);
		if (!opened) throw new Error(`link of ${email} did not open`);
		const orgSession = await h.org.sessions.resolve(orgId, opened.cookieValue);
		if (!orgSession) throw new Error("org session did not resolve");
		const session = await h.org.noteSession(orgSession, noteId);
		if (!session) throw new Error("note session did not open");
		return {
			session,
			cookie: opened.cookieValue,
			cookieName: orgSessionCookieName(orgId),
			base: `/o/${orgId}/n/${noteId}`,
			csrf: await h.service.sessions.csrfToken(session),
			email,
		};
	};

	/** A person-to-person note with both parties signed in. */
	const guestNote = async (idem = "share-1") => {
		const created = expectOk(
			await h.service.createNote({
				terms: TERMS,
				lender: { email: LENDER_EMAIL },
				borrower: { email: BORROWER_EMAIL },
				idem,
			}),
		);
		const lender = await openGuest(created.noteId, "lender", LENDER_EMAIL);
		const borrower = await openGuest(
			created.noteId,
			"borrower",
			BORROWER_EMAIL,
		);
		return { noteId: created.noteId, lender, borrower };
	};

	const header = (party: Party): string =>
		`${party.cookieName}=${party.cookie}`;

	/** Presses a form on the party's note page: `step` is the path after `/share/`. */
	const press = (
		party: Party,
		step: string,
		fields: Record<string, string> = {},
	) =>
		post(
			`${party.base}/share/${step}`,
			{ csrf: party.csrf, ...fields },
			header(party),
		);

	/** Consent through the page: the first press asks for a code, the second carries it. */
	const consent = async (party: Party, grantId: string): Promise<Response> => {
		const asked = await press(party, "consent", { grant_id: grantId });
		expect(asked.status).toBe(200);
		expect(await asked.text()).toContain("Enter your code");
		return press(party, "consent", {
			grant_id: grantId,
			code: h.mailer.codeFor(party.email),
		});
	};

	const events = async (noteId: string): Promise<NoteEvent[]> =>
		(await h.store.readLog(noteId)).events.map(
			(text) => JSON.parse(text) as NoteEvent,
		);

	const lastGrantId = async (noteId: string): Promise<string> => {
		for (const event of (await events(noteId)).reverse()) {
			if (
				event.type === "visibility.changed" &&
				event.change === "grant.proposed"
			)
				return event.grant_id;
		}
		throw new Error("no grant in the log");
	};

	/** Opens the newest link emailed to `email` the way a browser does; returns the cookie header and the ids. */
	const openShare = async (email = RECIPIENT) => {
		const text = h.mailer.to(email).at(-1)?.text ?? "";
		const matched =
			/\/s\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_-]+)\/enter\?t=([A-Za-z0-9_-]+)/.exec(
				text,
			);
		if (!matched) throw new Error(`no share link emailed to ${email}`);
		const [, noteId, grantId, token] = matched as unknown as [
			string,
			string,
			string,
			string,
		];
		expect((await get(`/s/${noteId}/${grantId}/enter?t=${token}`)).status).toBe(
			200,
		);
		const response = await post(`/s/${noteId}/${grantId}/enter`, { t: token });
		return { noteId, grantId, token, response, ...cookieOf(response) };
	};

	return {
		h,
		env,
		deps,
		ledger,
		get,
		post,
		openGuest,
		openAgent,
		guestNote,
		header,
		press,
		consent,
		events,
		lastGrantId,
		openShare,
	};
};

const SHARE_COOKIE_SET = /(__Host-tf_share_[^=;]+)=([^;]*)/;

/** The share cookie a redeem response set, as the value and as the header a browser would send back. */
export const cookieOf = (
	response: Response,
): { cookie: string | null; name: string | null; header: string } => {
	const matched = SHARE_COOKIE_SET.exec(
		response.headers.get("Set-Cookie") ?? "",
	);
	const name = matched?.[1] ?? null;
	const cookie = matched?.[2] ?? null;
	return {
		cookie,
		name,
		header: name && cookie ? `${name}=${cookie}` : "",
	};
};

const SIGN_OUT_FORM =
	/<form method="post" action="\/s\/[^"]+\/logout">[\s\S]*?<\/form>\n?/;

/**
 * A viewer's page without its sign-out button. The button carries the grant's own address and a token made for the
 * session, so it differs between sessions by design; every comparison of what a page says leaves it out.
 */
export const withoutSignOut = (html: string): string =>
	html.replace(SIGN_OUT_FORM, "");

/** The visible text of a page: tags and their attributes removed. */
export const textOf = (html: string): string =>
	html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]*>/g, " ");
