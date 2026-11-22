/** What a service method answers: its value, or a failure a route turns into a status and a message. */

export type ErrorCode =
	| "bad_request"
	| "invalid_terms"
	| "same_party"
	| "idempotency_conflict"
	| "not_found"
	| "mail_failed"
	| "forbidden_event"
	| "forbidden_field"
	| "wrong_role"
	| "bad_event"
	| "rejected"
	| "step_up_required"
	| "step_up_invalid"
	| "rate_limited"
	| "conflict"
	| "cooling_off"
	| "approval_required"
	| "chain_invalid"
	| "not_configured";

/**
 * `until` is set on `cooling_off`: the instant (UTC, ISO 8601) from which the step is allowed. `missing` is set on
 * `approval_required`: `request` when nobody has asked for the approval yet, `approval` when it is asked for and waits
 * for a board member other than the requester.
 */
export type Failure = {
	ok: false;
	error: ErrorCode;
	message: string;
	until?: string;
	missing?: "request" | "approval";
};
export type Outcome<T> = ({ ok: true } & T) | Failure;

export const failure = (
	error: ErrorCode,
	message: string,
	extra: { until?: string; missing?: "request" | "approval" } = {},
): Failure => ({ ok: false, error, message, ...extra });
