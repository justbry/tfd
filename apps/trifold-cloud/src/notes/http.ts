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
	terms_declined: 409,
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

/** A request body went past its limit. `notesRoute` answers it with a 413 whichever route was reading. */
export class BodyTooLargeError extends Error {
	constructor() {
		super("the request body is too large");
		this.name = "BodyTooLargeError";
	}
}

/**
 * The body's bytes. The limit is enforced while streaming, so a body with no `Content-Length` (chunked) or a false one
 * is cut off at `limit` bytes plus one chunk: the stream is cancelled and `BodyTooLargeError` thrown. A declared length
 * over the limit is refused without reading anything.
 */
export const readBodyBytes = async (
	request: Request,
	limit = MAX_BODY_BYTES,
): Promise<Uint8Array> => {
	const declared = Number(request.headers.get("Content-Length") ?? 0);
	if (declared > limit) throw new BodyTooLargeError();
	if (request.body === null) return new Uint8Array(0);
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.length;
		if (total > limit) {
			await reader.cancel();
			throw new BodyTooLargeError();
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.length;
	}
	return bytes;
};

/** The body as text, within the limit (see `readBodyBytes`). */
export const readBodyText = async (
	request: Request,
	limit = MAX_BODY_BYTES,
): Promise<string> =>
	new TextDecoder().decode(await readBodyBytes(request, limit));

/** The form fields of a body within the limit, or null when it is not a readable form. A body over the limit throws. */
export const readForm = async (
	request: Request,
): Promise<Record<string, string> | null> => {
	const bytes = await readBodyBytes(request);
	try {
		const form = await new Response(bytes, {
			headers: {
				"Content-Type": request.headers.get("Content-Type") ?? "",
			},
		}).formData();
		const fields: Record<string, string> = {};
		for (const [name, value] of form) {
			if (typeof value === "string") fields[name] = value;
		}
		return fields;
	} catch {
		return null;
	}
};

/** The parsed JSON of a body within the limit, or undefined when it is not JSON. A body over the limit throws. */
export const readJson = async (request: Request): Promise<unknown> => {
	const text = await readBodyText(request);
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
