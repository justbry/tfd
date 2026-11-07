/**
 * The typed failures of the HTTP adapters (S8e). Every rejection of `createHttpReader` and `createHttpWriter` is an
 * `AdapterError`, so the UI can tell "try again" from "not allowed" from "nothing provides this yet":
 *
 * - `step_up`: the route wants the mailed-link confirmation of the last 10 minutes (buzz-school 403
 *   `step_up_required`).
 * - `pin_required`, `pin_wrong`, `pin_locked`: the family PIN is closed, was typed wrong, or too many tries were spent
 *   (429 on `POST /family/pin/verify`).
 * - `unauthenticated` (401), `forbidden` (another 403: `owner_only`, `pin_not_set`, `finance_required`,
 *   `audience_not_allowed`), `not_found` (404), `no_data` (the Worker's 404 `no_data`), `conflict` (409),
 *   `rate_limited` (429), `bad_request` (400).
 * - `unavailable`: buzz-school's 503 `school_api_unavailable` or the Worker's 503 `views_unavailable`. It means "try
 *   again", never "no schools" and never an empty answer.
 * - `server` (another 5xx) and `network` (no answer at all).
 * - `schema_mismatch`: the route answered a shape the UI contract cannot take without inventing a field.
 * - `not_available`: nothing provides this call yet (the contract's D11/D12: a gap, never a 0 or fixture data).
 * - `not_connected`: a ledger Worker call before part 2 connects the Worker.
 */
export type AdapterErrorKind =
	| "step_up"
	| "pin_required"
	| "pin_wrong"
	| "pin_locked"
	| "unauthenticated"
	| "forbidden"
	| "not_found"
	| "no_data"
	| "conflict"
	| "rate_limited"
	| "bad_request"
	| "unavailable"
	| "server"
	| "network"
	| "schema_mismatch"
	| "not_available"
	| "not_connected";

export type AdapterErrorDetail = {
	/** The HTTP status, when there was an answer. */
	status?: number;
	/** The server's code (`error` on buzz-school, `error.code` on the Worker). */
	code?: string;
	field?: string;
	retryAfterSeconds?: number;
};

export class AdapterError extends Error {
	override readonly name = "AdapterError";
	constructor(
		readonly kind: AdapterErrorKind,
		message: string,
		readonly detail: AdapterErrorDetail = {},
	) {
		super(message);
	}
}

/** Failures worth trying again with the same request (and the same `Idempotency-Key`). */
const retryableKinds: ReadonlySet<AdapterErrorKind> = new Set([
	"unavailable",
	"network",
	"rate_limited",
	"server",
]);
export const isRetryable = (error: unknown): boolean =>
	error instanceof AdapterError && retryableKinds.has(error.kind);

/** A call nothing provides yet. `reference` names the contract row or route gap that says so. */
export const notAvailable = (call: string, reference: string): AdapterError =>
	new AdapterError("not_available", `${call} is not available: ${reference}`, {
		code: "not_available",
	});

/** A route answer that the UI contract cannot take as it is. */
export const schemaMismatch = (route: string, problem: string): AdapterError =>
	new AdapterError("schema_mismatch", `${route}: ${problem}`, {
		code: "schema_mismatch",
	});
