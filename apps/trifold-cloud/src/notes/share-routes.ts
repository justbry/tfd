import {
	BodyTooLargeError,
	forbiddenPage,
	MAX_BODY_BYTES,
	page,
	readBodyText,
	readForm,
	redirect,
	sameOrigin,
} from "./http";
import { isValidNoteId } from "./note-ids";
import { COOKIE_ATTRIBUTES, readCookie } from "./sessions";
import type { ShareAccess } from "./share-access";
import { parseVerifyToken } from "./share-core";
import {
	sharedViewPage,
	shareEndedPage,
	shareEnterPage,
	shareInvalidLinkPage,
	shareSignInPage,
	signedOutSharePage,
	verifyPage,
} from "./share-pages";

/**
 * What a recipient reaches, staging only like every notes route (build step 5):
 *
 * | Host | Route | Auth |
 * |---|---|---|
 * | ledger | `GET /s/:noteId/:grantId/enter?t=` | none; shows a button, redeems nothing |
 * | ledger | `POST /s/:noteId/:grantId/enter` | the link token in the form; single use |
 * | ledger | `POST /s/:noteId/:grantId/logout` | share session and CSRF token; ends the session on the server |
 * | ledger | `GET /s/:noteId/:grantId` | share session cookie for that grant; read-only |
 * | ledger | `GET /v/:token`, `POST /v/:token` | the token in the path; no cookie |
 *
 * A share session reads one page and nothing else: any other method on its page is refused. Its cookie has a name of its
 * own for each grant (`__Host-tf_share_<noteId>_<grantId>`), so the note and organization routes never read it and it
 * opens nothing there. Every route checks the note id's MAC first (`isValidNoteId`): an id never made here is the same
 * 404 as a malformed one, and no store is touched.
 */

const SHARE_PATH =
	/^\/s\/([A-Za-z0-9_.-]{1,200})\/([A-Za-z0-9_-]{1,80})(?:\/(enter|logout))?\/?$/;
const VERIFY_PATH = /^\/v\/([A-Za-z0-9_.-]{1,300})\/?$/;

/** One cookie name per grant (`__Host-` needs `Path=/`, so the scope is in the name). */
export const shareCookieName = (noteId: string, grantId: string): string =>
	`__Host-tf_share_${noteId}_${grantId}`;

export const shareCookie = (
	noteId: string,
	grantId: string,
	value: string,
	maxAgeSeconds: number,
): string =>
	`${shareCookieName(noteId, grantId)}=${value}; ${COOKIE_ATTRIBUTES}; Max-Age=${maxAgeSeconds}`;

const clearedShareCookie = (noteId: string, grantId: string): string =>
	shareCookie(noteId, grantId, "", 0);

export const readShareCookie = (
	header: string | null,
	noteId: string,
	grantId: string,
): string | null => readCookie(header, shareCookieName(noteId, grantId));

export const ownsSharePath = (url: URL): boolean =>
	SHARE_PATH.test(url.pathname) || VERIFY_PATH.test(url.pathname);

const endedPage = (clear?: string): Response =>
	page(shareEndedPage(), 404, clear ? { "Set-Cookie": clear } : {});

const sharePage = (
	view: Parameters<typeof sharedViewPage>[0],
	logout: { action: string; csrf: string },
): Response => page(sharedViewPage(view, logout));

const handleEnter = async (
	request: Request,
	url: URL,
	access: ShareAccess,
	noteId: string,
	grantId: string,
): Promise<Response | null> => {
	if (request.method === "GET")
		return page(shareEnterPage(noteId, grantId, url.searchParams.get("t")));
	if (request.method !== "POST") return null;
	if (!sameOrigin(request, url))
		return forbiddenPage("That request came from another site.");
	const form = await readForm(request);
	const token = form?.t;
	if (!token) return page(shareInvalidLinkPage(), 400);
	const opened = await access.redeem(noteId, grantId, token);
	if (opened === null) return page(shareInvalidLinkPage(), 400);
	// The target holds no token: it was in the body, and the cookie is HttpOnly and scoped to this grant.
	return redirect(
		`/s/${noteId}/${grantId}`,
		shareCookie(noteId, grantId, opened.cookieValue, opened.maxAgeSeconds),
	);
};

const handleView = async (
	request: Request,
	access: ShareAccess,
	noteId: string,
	grantId: string,
): Promise<Response> => {
	// A share session never writes: whatever it posts, the answer is no.
	if (request.method !== "GET") return forbiddenPage("This page is read-only.");
	const cookie = readShareCookie(
		request.headers.get("Cookie"),
		noteId,
		grantId,
	);
	if (!(await access.hasSession(noteId, grantId, cookie)))
		return page(shareSignInPage(), 401);
	const view = await access.viewOf(noteId, grantId);
	if (view === null) return endedPage(clearedShareCookie(noteId, grantId));
	return sharePage(view, {
		action: `/s/${noteId}/${grantId}/logout`,
		csrf: await access.csrfToken(noteId, grantId, cookie as string),
	});
};

/** Ends this share session on the server and clears the cookie. A form post with the CSRF token. */
const handleLogout = async (
	request: Request,
	url: URL,
	access: ShareAccess,
	noteId: string,
	grantId: string,
): Promise<Response | null> => {
	if (request.method !== "POST") return null;
	if (!sameOrigin(request, url))
		return forbiddenPage("That request came from another site.");
	const cookie = readShareCookie(
		request.headers.get("Cookie"),
		noteId,
		grantId,
	);
	if (!(await access.hasSession(noteId, grantId, cookie)))
		return page(shareSignInPage(), 401);
	const form = await readForm(request);
	if (
		!(await access.checkCsrf(
			noteId,
			grantId,
			cookie as string,
			form?.csrf ?? null,
		))
	)
		return forbiddenPage("That form has expired. Go back and try again.");
	await access.endSession(noteId, grantId, cookie as string);
	return page(signedOutSharePage(), 200, {
		"Set-Cookie": clearedShareCookie(noteId, grantId),
	});
};

/** A person share's routes, or null when the path is not one. */
export const shareRoute = async (
	request: Request,
	url: URL,
	access: ShareAccess,
	secret: string,
): Promise<Response | null> => {
	const matched = SHARE_PATH.exec(url.pathname);
	if (matched === null) return null;
	const noteId = matched[1] as string;
	const grantId = matched[2] as string;
	if (!(await isValidNoteId(secret, noteId))) return endedPage();
	if (matched[3] === "enter")
		return handleEnter(request, url, access, noteId, grantId);
	if (matched[3] === "logout")
		return handleLogout(request, url, access, noteId, grantId);
	return handleView(request, access, noteId, grantId);
};

/** The pasted document: a form field `document`, or the whole body when it is sent as JSON. */
const documentOf = (request: Request, body: string): string => {
	const type = request.headers.get("Content-Type") ?? "";
	if (type.includes("application/json")) return body;
	return new URLSearchParams(body).get("document") ?? "";
};

const handleVerify = async (
	request: Request,
	url: URL,
	access: ShareAccess,
	token: string,
): Promise<Response | null> => {
	if (request.method !== "GET" && request.method !== "POST") return null;
	const context = await access.verifyContext(token);
	if (context === null) return endedPage();
	const base = { token };
	if (request.method === "GET") return page(verifyPage(base));
	if (!sameOrigin(request, url))
		return forbiddenPage("That request came from another site.");
	let body: string;
	try {
		body = await readBodyText(request, MAX_BODY_BYTES);
	} catch (error) {
		if (error instanceof BodyTooLargeError)
			return page(verifyPage({ ...base, result: { kind: "too_large" } }), 413);
		throw error;
	}
	const result = await access.checkDocument(context, documentOf(request, body));
	return page(verifyPage({ ...base, result }));
};

/** The verify link's routes, or null when the path is not one. */
export const verifyRoute = async (
	request: Request,
	url: URL,
	access: ShareAccess,
	secret: string,
): Promise<Response | null> => {
	const matched = VERIFY_PATH.exec(url.pathname);
	if (matched === null) return null;
	const token = matched[1] as string;
	const parsed = parseVerifyToken(token);
	if (parsed === null || !(await isValidNoteId(secret, parsed.noteId)))
		return endedPage();
	return handleVerify(request, url, access, token);
};
