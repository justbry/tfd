import { boardReport, boardReportCsv } from "tfd-notes";
import {
	download,
	forbiddenPage,
	page,
	readForm,
	redirect,
	STATUS_OF,
	sameOrigin,
} from "./http";
import {
	orgEnterPage,
	orgInvalidLinkPage,
	orgLinkRequestedPage,
	orgSignInRequiredPage,
	portfolioPage,
} from "./org-pages";
import type { OrgService } from "./org-service";
import {
	clearedOrgSessionCookie,
	type OrgSession,
	orgSessionCookie,
	readOrgSessionCookie,
} from "./org-sessions";
import { messagePage, signedOutPage } from "./pages";
import type { GetSession } from "./sessions";

/**
 * The organization's own pages (build step 4), staging only like every notes route:
 *
 * | Host | Route | Auth |
 * |---|---|---|
 * | ledger | `GET /o/:orgId/enter?t=&n=` | none; shows a button, redeems nothing |
 * | ledger | `POST /o/:orgId/enter` | the link token in the form |
 * | ledger | `POST /o/:orgId/link` | none; same answer for any address |
 * | ledger | `POST /o/:orgId/logout` | organization session and CSRF token; ends the session on the server |
 * | ledger | `GET /o/:orgId` | organization session, any role |
 * | ledger | `GET /o/:orgId/board.csv`, `/board.json` | organization session, treasurer or board |
 *
 * The note pages of an agent (`/o/:orgId/n/:id...`) are dispatched by `routes.ts` with `orgNoteSession`.
 */

const ORG_PATH =
	/^\/o\/([A-Za-z0-9_-]{1,64})(?:\/(enter|link|logout|board\.csv|board\.json))?\/?$/;
const NOTE_PARAM = /^[A-Za-z0-9_.-]{8,80}$/;

export const ownsOrgPath = (url: URL): boolean => ORG_PATH.test(url.pathname);

const notFoundPage = (): Response =>
	page(messagePage("Not found", "Nothing here."), 404);

const orgSessionOf = (
	org: OrgService,
	request: Request,
	orgId: string,
): Promise<OrgSession | null> =>
	org.sessions.resolve(
		orgId,
		readOrgSessionCookie(request.headers.get("Cookie"), orgId),
	);

const signedOut = (orgId: string, clear: boolean): Response =>
	page(
		orgSignInRequiredPage(orgId),
		401,
		clear ? { "Set-Cookie": clearedOrgSessionCookie(orgId) } : {},
	);

/**
 * The session getter for one note under an organization: the agent's organization session, then the check that the note is
 * this organization's and the agent is active on it. No session is the sign-in page (401); a session that does not own
 * the note is a plain 404, so one organization learns nothing about another's notes.
 */
export const orgNoteSession =
	(org: OrgService, orgId: string, noteId: string): GetSession =>
	async (request, clear) => {
		const session = await orgSessionOf(org, request, orgId);
		if (session === null) return signedOut(orgId, clear);
		return (await org.noteSession(session, noteId)) ?? notFoundPage();
	};

const handleEnter = async (
	request: Request,
	url: URL,
	org: OrgService,
	orgId: string,
): Promise<Response | null> => {
	if (request.method === "GET") {
		const note = url.searchParams.get("n");
		return page(
			orgEnterPage(
				orgId,
				url.searchParams.get("t"),
				note !== null && NOTE_PARAM.test(note) ? note : null,
			),
		);
	}
	if (request.method !== "POST") return null;
	if (!sameOrigin(request, url))
		return forbiddenPage("That request came from another site.");
	const form = await readForm(request);
	const token = form?.t;
	if (!token) return page(orgInvalidLinkPage(orgId), 400);
	const opened = await org.sessions.redeem(orgId, token);
	if (opened === null) return page(orgInvalidLinkPage(orgId), 400);
	const note = form?.n ?? "";
	const target = NOTE_PARAM.test(note)
		? `/o/${orgId}/n/${note}?m=entered`
		: `/o/${orgId}`;
	// The target holds no token; the token was in the body, and the cookie is HttpOnly and scoped to this organization.
	return redirect(
		target,
		orgSessionCookie(orgId, opened.cookieValue, opened.maxAgeSeconds),
	);
};

const handleLink = async (
	request: Request,
	url: URL,
	org: OrgService,
	orgId: string,
): Promise<Response | null> => {
	if (request.method !== "POST") return null;
	if (!sameOrigin(request, url))
		return forbiddenPage("That request came from another site.");
	const form = await readForm(request);
	await org.requestLink(
		orgId,
		form?.email ?? "",
		request.headers.get("CF-Connecting-IP") ?? undefined,
	);
	return page(orgLinkRequestedPage());
};

/** Ends this organization session on the server and clears the cookie. A form post with the CSRF token. */
const handleLogout = async (
	request: Request,
	url: URL,
	org: OrgService,
	orgId: string,
): Promise<Response | null> => {
	if (request.method !== "POST") return null;
	if (!sameOrigin(request, url))
		return forbiddenPage("That request came from another site.");
	const session = await orgSessionOf(org, request, orgId);
	if (session === null) return signedOut(orgId, false);
	const form = await readForm(request);
	if (!(await org.sessions.checkCsrf(session, form?.csrf ?? null)))
		return forbiddenPage("That form has expired. Go back and try again.");
	await org.sessions.end(session);
	return page(signedOutPage(), 200, {
		"Set-Cookie": clearedOrgSessionCookie(orgId),
	});
};

const handlePortfolio = async (
	request: Request,
	org: OrgService,
	orgId: string,
): Promise<Response | null> => {
	if (request.method !== "GET") return null;
	const session = await orgSessionOf(org, request, orgId);
	if (session === null) return signedOut(orgId, true);
	const result = await org.portfolio(orgId, undefined, session.agentId);
	if (!result.ok)
		return page(
			messagePage("Not available", result.message),
			STATUS_OF[result.error],
		);
	return page(
		portfolioPage({
			orgId,
			role: session.role,
			csrf: await org.sessions.csrfToken(session),
			asOf: result.asOf,
			data: result,
		}),
	);
};

const handleBoard = async (
	request: Request,
	url: URL,
	org: OrgService,
	orgId: string,
	asCsv: boolean,
): Promise<Response | null> => {
	if (request.method !== "GET") return null;
	const session = await orgSessionOf(org, request, orgId);
	if (session === null) return signedOut(orgId, true);
	if (session.role === "viewer")
		return page(
			messagePage(
				"Not allowed",
				"The board report is for treasurers and board members.",
			),
			403,
		);
	const result = await org.portfolio(
		orgId,
		url.searchParams.get("as_of") || undefined,
	);
	if (!result.ok)
		return page(
			messagePage("Not available", result.message),
			STATUS_OF[result.error],
		);
	const report = boardReport(result.portfolio, result.asOf);
	return asCsv
		? download(
				boardReportCsv(report),
				`board-report-${result.asOf}.csv`,
				"text/csv; charset=utf-8",
			)
		: download(JSON.stringify(report), `board-report-${result.asOf}.json`);
};

/**
 * An organization-level request, or null when the path is not one. An organization nobody registered gets exactly what
 * a known one gets from a visitor who is not signed in (the sign-in page, the same form, the same link answer), so
 * the answers tell a stranger nothing about which organizations exist.
 */
export const orgRoute = async (
	request: Request,
	url: URL,
	org: OrgService,
): Promise<Response | null> => {
	const matched = ORG_PATH.exec(url.pathname);
	if (matched === null) return null;
	const orgId = matched[1] as string;
	switch (matched[2]) {
		case "enter":
			return handleEnter(request, url, org, orgId);
		case "link":
			return handleLink(request, url, org, orgId);
		case "logout":
			return handleLogout(request, url, org, orgId);
		case "board.csv":
			return handleBoard(request, url, org, orgId, true);
		case "board.json":
			return handleBoard(request, url, org, orgId, false);
		default:
			return handlePortfolio(request, org, orgId);
	}
};
