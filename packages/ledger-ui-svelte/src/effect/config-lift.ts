import { Effect } from "effect";
import { UiError } from "./ui-error.ts";

/** A promise of a route's checks as an effect: a `UiError` it rejects with is the failure, anything else `unexpected`. */
export const liftConfig = <A>(
	call: () => Promise<A>,
): Effect.Effect<A, UiError> =>
	Effect.tryPromise({
		try: call,
		catch: (thrown) =>
			thrown instanceof UiError
				? thrown
				: new UiError({
						kind: "unexpected",
						detail: {},
						reason: String(thrown),
						retryable: false,
						thrown,
					}),
	});
