import { Data } from "effect";
import {
	AdapterError,
	type AdapterErrorDetail,
	type AdapterErrorKind,
	isRetryable,
} from "$contract/http/errors.ts";

/** Every failure the app shows has this one shape (S9-plan section 5): an adapter's kind, or `unexpected` for
 * anything that is not an `AdapterError`. */
export type UiErrorKind = AdapterErrorKind | "unexpected";

/** One field-level problem: a config write's `problems[]` (section 4), or an adapter's `field`. */
export type FieldProblem = {
	path: string;
	message: string;
	hint?: string;
};

export type UiErrorDetail = AdapterErrorDetail & {
	/** A rejected config value's problems (`422 invalid_config`). */
	problems?: readonly FieldProblem[];
};

export class UiError extends Data.TaggedError("UiError")<{
	readonly kind: UiErrorKind;
	readonly detail: UiErrorDetail;
	/** The adapter's own message: for the log and the toast's detail line, never the toast's title. */
	readonly reason: string;
	/** Trying the same request again may work (the adapter's `isRetryable`). */
	readonly retryable: boolean;
	/** What was thrown, kept for the log when the kind is `unexpected`. */
	readonly thrown?: unknown;
}> {}

const describe = (thrown: unknown): string => {
	if (thrown instanceof Error) return thrown.message || thrown.name;
	if (typeof thrown === "string") return thrown;
	return "Something failed without saying what.";
};

/** An `AdapterError` keeps its kind and detail; anything else becomes `unexpected`. */
export function toUiError(thrown: unknown): UiError {
	if (thrown instanceof UiError) return thrown;
	if (thrown instanceof AdapterError)
		return new UiError({
			kind: thrown.kind,
			detail: thrown.detail,
			reason: thrown.message,
			retryable: isRetryable(thrown),
		});
	return new UiError({
		kind: "unexpected",
		detail: {},
		reason: describe(thrown),
		retryable: false,
		thrown,
	});
}

/** The field problems of an error: its `problems[]`, else its single `field`. */
export function fieldProblems(error: UiError): readonly FieldProblem[] {
	if (error.detail.problems?.length) return error.detail.problems;
	if (error.detail.field)
		return [{ path: error.detail.field, message: error.reason }];
	return [];
}
