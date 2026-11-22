import { messagePage, NOTES_CSP } from "./pages";
import type { ErrorCode, Failure } from "./service";

/** The small HTTP helpers every notes route shares: pages and JSON with the right headers, forms, and error mapping. */

export const MAX_BODY_BYTES = 64 * 1024;
export const NO_STORE = "no-store";
export const NO_REFERRER = "no-referrer";

const HTML_HEADERS = {
	"Content-Type": "text/html; charset=utf-8",
	"Cache-Control": NO_STORE,
	"Referrer-Policy": NO_REFERRER,
	"Content-Security-Policy": NOTES_CSP,
};

export const page = (
	body: string,
	status = 200,
	extra: HeadersInit = {},
): Response => {
	const headers = new Headers(HTML_HEADERS);
	for (const [name, value] of new Headers(extra)) headers.append(name, value);
	return new Response(body, { status, headers });
};

export const redirect = (location: string, cookie?: string): Response => {
	const headers = new Headers({
		Location: location,
		"Cache-Control": NO_STORE,
		"Referrer-Policy": NO_REFERRER,
	});
	if (cookie) headers.append("Set-Cookie", cookie);
	return new Response(null, { status: 303, headers });
};

export const json = (
	body: unknown,
	status = 200,
	extra: HeadersInit = {},
): Response => {
	const headers = new Headers({
		"Cache-Control": NO_STORE,
		"Referrer-Policy": NO_REFERRER,
	});
	for (const [name, value] of new Headers(extra)) headers.set(name, value);
	return Response.json(body, { status, headers });
};

export const apiError = (
	status: number,
	code: string,
	message: string,
	extra: Record<string, unknown> = {},
): Response => json({ error: { code, message, ...extra } }, status);

export const notFound = (): Response =>
	apiError(404, "not_found", "Nothing here.");

export const STATUS_OF: Record<ErrorCode, number> = {
	bad_request: 400,
	invalid_terms: 422,
	same_party: 400,
	idempotency_conflict: 409,
	not_found: 404,
	mail_failed: 502,
	forbidden_event: 403,
	forbidden_field: 403,
	wrong_role: 403,
	bad_event: 422,
	rejected: 422,
	step_up_required: 403,
	step_up_invalid: 403,
	rate_limited: 429,
	conflict: 409,
	cooling_off: 409,
	approval_required: 409,
	chain_invalid: 409,
	not_configured: 503,
};

export const failureResponse = (failure: Failure): Response =>
	apiError(
		STATUS_OF[failure.error],
		failure.error,
		failure.message,
		failure.missing === undefined ? {} : { missing: failure.missing },
	);

/** Refuses a cross-site form post: a browser sends `Origin` on every POST, and it must be this host. */
export const sameOrigin = (request: Request, url: URL): boolean => {
	const origin = request.headers.get("Origin");
	return origin === null || origin === url.origin;
};

export const readForm = async (
	request: Request,
): Promise<Record<string, string> | null> => {
	const length = Number(request.headers.get("Content-Length") ?? 0);
	if (length > MAX_BODY_BYTES) return null;
	try {
		const form = await request.formData();
		const fields: Record<string, string> = {};
		for (const [name, value] of form) {
			if (typeof value === "string") fields[name] = value;
		}
		return fields;
	} catch {
		return null;
	}
};

export const readJson = async (request: Request): Promise<unknown> => {
	const text = await request.text();
	if (text.length > MAX_BODY_BYTES) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
};

export const forbiddenPage = (text: string): Response =>
	page(messagePage("Not allowed", text), 403);

/** A file the browser saves instead of rendering or sniffing. */
export const download = (
	text: string,
	filename: string,
	contentType = "application/json",
): Response =>
	new Response(text, {
		headers: {
			"Content-Type": contentType,
			"Content-Disposition": `attachment; filename="${filename}"`,
			"X-Content-Type-Options": "nosniff",
			"Cache-Control": NO_STORE,
			"Referrer-Policy": NO_REFERRER,
		},
	});
