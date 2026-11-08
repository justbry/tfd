/** The wire: the success envelope, the error body and the headers every answer carries (contract section 11). */

const NO_STORE = "private, no-store";
const MS_PER_MINUTE = 60_000;

export type ErrorCode =
	| "token_missing"
	| "token_invalid"
	| "token_expired"
	| "finance_required"
	| "audience_not_allowed"
	| "not_found"
	| "no_data"
	| "bad_request"
	| "view_mismatch"
	| "rate_limited"
	| "not_available"
	| "views_unavailable"
	| "jwks_unavailable"
	| "method_not_allowed"
	| "owner_only"
	| "step_up_required"
	| "demo_read_only"
	| "stale_etag"
	| "invalid_config";

const STATUS: Record<ErrorCode, number> = {
	token_missing: 401,
	token_invalid: 401,
	token_expired: 401,
	finance_required: 403,
	audience_not_allowed: 403,
	not_found: 404,
	no_data: 404,
	bad_request: 400,
	view_mismatch: 409,
	rate_limited: 429,
	not_available: 501,
	views_unavailable: 503,
	jwks_unavailable: 503,
	method_not_allowed: 405,
	owner_only: 403,
	step_up_required: 403,
	demo_read_only: 403,
	stale_etag: 412,
	invalid_config: 422,
};

/** A problem with a config value (S9 plan section 4): where, what, and what to do about it. */
export type ConfigProblem = { path: string; message: string; hint: string };

/** Thrown anywhere under a handler; `worker.ts` turns it into the error body. */
export class ApiError extends Error {
	readonly code: ErrorCode;
	readonly field: string | undefined;
	readonly retryAfterSeconds: number | undefined;
	readonly problems: readonly ConfigProblem[] | undefined;

	constructor(
		code: ErrorCode,
		message: string,
		extra: {
			field?: string;
			retryAfterSeconds?: number;
			problems?: readonly ConfigProblem[];
		} = {},
	) {
		super(message);
		this.code = code;
		this.field = extra.field;
		this.retryAfterSeconds = extra.retryAfterSeconds;
		this.problems = extra.problems;
	}

	get status(): number {
		return STATUS[this.code];
	}
}

const baseHeaders = (): Headers =>
	new Headers({
		"content-type": "application/json; charset=utf-8",
		"cache-control": NO_STORE,
		"x-content-type-options": "nosniff",
	});

export const errorResponse = (error: ApiError): Response => {
	const headers = baseHeaders();
	if (error.status === 401)
		headers.set("www-authenticate", 'Bearer error="invalid_token"');
	if (error.retryAfterSeconds !== undefined)
		headers.set("retry-after", String(error.retryAfterSeconds));
	return new Response(
		JSON.stringify({
			// no views yet: there is no `asOf` to give, and the UI reads the nulls as "no ledger data yet"
			...(error.code === "no_data" ? { asOf: null, lagMinutes: null } : {}),
			error: {
				code: error.code,
				message: error.message,
				...(error.field === undefined ? {} : { field: error.field }),
				...(error.retryAfterSeconds === undefined
					? {}
					: { retryAfterSeconds: error.retryAfterSeconds }),
				...(error.problems === undefined ? {} : { problems: error.problems }),
			},
		}),
		{ status: error.status, headers },
	);
};

/** `now` minus `asOf`, whole minutes rounded up, never negative. */
export const lagMinutesOf = (asOf: string, now: number): number =>
	Math.max(0, Math.ceil((now - Date.parse(asOf)) / MS_PER_MINUTE));

export const okResponse = (
	data: unknown,
	freshness: { asOf: string | null; lagMinutes: number | null },
	headers: Record<string, string> = {},
): Response => {
	const responseHeaders = baseHeaders();
	for (const [name, value] of Object.entries(headers))
		responseHeaders.set(name, value);
	return new Response(JSON.stringify({ ...freshness, data }), {
		status: 200,
		headers: responseHeaders,
	});
};

/**
 * A stored answer (`routes/stored.ts`): `data` is its JSON text, put in the envelope as it is, so the bytes are the ones
 * `okResponse` writes for the same value.
 */
export const storedResponse = (
	data: string,
	freshness: { asOf: string; lagMinutes: number },
	headers: Record<string, string>,
): Response => {
	const responseHeaders = baseHeaders();
	for (const [name, value] of Object.entries(headers))
		responseHeaders.set(name, value);
	return new Response(
		`{"asOf":${JSON.stringify(freshness.asOf)},"lagMinutes":${JSON.stringify(freshness.lagMinutes)},"data":${data}}`,
		{ status: 200, headers: responseHeaders },
	);
};

/** `304 Not Modified` for an `If-None-Match` that names the answer's ETag: no body, the validators again. */
export const notModifiedResponse = (
	headers: Record<string, string>,
): Response => new Response(null, { status: 304, headers });

export const plainResponse = (body: unknown): Response =>
	new Response(JSON.stringify(body), { status: 200, headers: baseHeaders() });
