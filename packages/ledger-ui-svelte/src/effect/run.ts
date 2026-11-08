import { Effect } from "effect";
import { Log, Reader, Writer } from "./services.ts";
import { toUiError, type UiError } from "./ui-error.ts";

/** The one bridge from the promise contract to Effect (S9-plan section 5): a rejected call fails with a `UiError`,
 * its kind kept from an `AdapterError` or `unexpected` for anything else, which is also written to the log. */
export const run = <A>(
	call: () => Promise<A>,
): Effect.Effect<A, UiError, Log> =>
	Effect.tryPromise({ try: call, catch: toUiError }).pipe(
		Effect.tapError((error) =>
			error.kind === "unexpected"
				? Log.use((log) =>
						log.write({
							level: "error",
							message: error.reason,
							cause: error.thrown,
						}),
					)
				: Effect.void,
		),
	);

/** A Reader call as an effect. */
export const read = <A>(
	call: (reader: Reader["Service"]) => Promise<A>,
): Effect.Effect<A, UiError, Reader | Log> =>
	Reader.use((reader) => run(() => call(reader)));

/** A Writer call as an effect. */
export const write = <A>(
	call: (writer: Writer["Service"]) => Promise<A>,
): Effect.Effect<A, UiError, Writer | Log> =>
	Writer.use((writer) => run(() => call(writer)));
