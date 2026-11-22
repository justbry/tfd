import {
	forbiddenPage,
	MAX_BODY_BYTES,
	page,
	readForm,
	redirect,
	sameOrigin,
} from "./http";
import { messagePage } from "./pages";
import type { ShareAccess } from "./share-access";
import {
	sharedViewPage,
	shareEndedPage,
	shareEnterPage,
	shareInvalidLinkPage,
	shareSignInPage,
	verifyPage,
} from "./share-pages";

/**
 * What a recipient reaches, staging only like every notes route (build step 5):
 *
 * | Host | Route | Auth |
 * |---|---|---|
 * | ledger | `GET /s/:noteId/:grantId/enter?t=` | none; shows a button, redeems nothing |
 * | ledger | `POST /s/:noteId/:grantId/enter` | the link token in the form; single use |
 * | ledger | `GET /s/:noteId/:grantId` | share session cookie for that grant; read-only |
 * | ledger | `GET /v/:token`, `POST /v/:token` | the token in the path; no cookie |
 *
 * A share session reads one page and nothing else: any other method on its page is refused, and its cookie is scoped to
 * `/s/:noteId/:grantId`, so it never reaches `/n/...` or `/o/...`.
 */

const SHARE_PATH =
	/^\/s\/([A-Za-z0-9_-]{8,80})\/([A-Za-z0-9_-]{1,80})(?:\/(enter))?\/?$/;
const VERIFY_PATH = /^\/v\/([A-Za-z0-9_.-]{1,300})\/?$/;

/** Share session cookie. Its Path is the grant, so `__Host-` is not possible. */
export const SHARE_COOKIE = "__Secure-tf_share";

export const shareCookie = (
	noteId: string,
	grantId: string,
	value: string,
	maxAgeSeconds: number,
): string =>
	`${SHARE_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/s/${noteId}/${grantId}; Max-Age=${maxAgeSeconds}`;

const clearedShareCookie = (noteId: string, grantId: string): string =>
	shareCookie(noteId, grantId, "", 0);

export const readShareCookie = (header: string | null): string | null => {
	if (!header) return null;
	for (const part of header.split(";")) {
		const [name, ...rest] = part.trim().split("=");
		if (name === SHARE_COOKIE) return rest.join("=") || null;
	}
	return null;
};

export const ownsSharePath = (url: URL): boolean =>
	SHARE_PATH.test(url.pathname) || VERIFY_PATH.test(url.pathname);

const endedPage = (clear?: string): Response =>
	page(shareEndedPage(), 404, clear ? { "Set-Cookie": clear } : {});

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
	const cookie = readShareCookie(request.headers.get("Cookie"));
	if (!(await access.hasSession(noteId, grantId, cookie)))
		return page(shareSignInPage(), 401);
	const view = await access.viewOf(noteId, grantId);
	return view === null
		? endedPage(clearedShareCookie(noteId, grantId))
		: page(sharedViewPage(view));
};

/** A person share's routes, or null when the path is not one. */
export const shareRoute = async (
	request: Request,
	url: URL,
	access: ShareAccess,
): Promise<Response | null> => {
	const matched = SHARE_PATH.exec(url.pathname);
	if (matched === null) return null;
	const noteId = matched[1] as string;
	const grantId = matched[2] as string;
	if (matched[3] === "enter")
		return handleEnter(request, url, access, noteId, grantId);
	return handleView(request, access, noteId, grantId);
};

/** The body as text, or null when it is larger than `limit` bytes. Reads no more than `limit` plus one chunk. */
const readBounded = async (
	request: Request,
	limit: number,
): Promise<string | null> => {
	const declared = Number(request.headers.get("Content-Length") ?? 0);
	if (declared > limit) return null;
	if (request.body === null) return "";
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.length;
		if (total > limit) {
			await reader.cancel();
			return null;
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.length;
	}
	return new TextDecoder().decode(bytes);
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
	const base = { token, noteId: context.noteId, documents: context.documents };
	if (request.method === "GET") return page(verifyPage(base));
	if (!sameOrigin(request, url))
		return forbiddenPage("That request came from another site.");
	const body = await readBounded(request, MAX_BODY_BYTES);
	if (body === null)
		return page(verifyPage({ ...base, result: { kind: "too_large" } }), 413);
	const result = await access.checkDocument(context, documentOf(request, body));
	return page(verifyPage({ ...base, result }));
};

/** The verify link's routes, or null when the path is not one. */
export const verifyRoute = async (
	request: Request,
	url: URL,
	access: ShareAccess,
): Promise<Response | null> => {
	const matched = VERIFY_PATH.exec(url.pathname);
	if (matched === null) return null;
	return handleVerify(request, url, access, matched[1] as string);
};

/** The page for a request that a share session's cookie should never reach: `/n/...` and `/o/...`. */
export const shareCookieRefusal = (request: Request): Response | null =>
	readShareCookie(request.headers.get("Cookie")) === null
		? null
		: page(messagePage("Not allowed", "A shared view cannot do that."), 403);
