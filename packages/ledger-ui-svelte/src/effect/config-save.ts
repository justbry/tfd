import { Cause, Effect } from "effect";
import type {
	ConfigApi,
	ConfigName,
	ConfigPut,
	ConfigValues,
} from "./config-client.ts";
import { UiError } from "./ui-error.ts";

/** Recovers from a `UiError` that `when` accepts, the way `catchIf` would, with the operators the first page load
 * already carries (a lazy pane's use of another one would move that operator's code into the first load's chunk). */
export const recoverFrom = <A, B, R, S>(
	effect: Effect.Effect<A, UiError, R>,
	when: (error: UiError) => boolean,
	recover: (error: UiError) => Effect.Effect<B, UiError, S>,
): Effect.Effect<A | B, UiError, R | S> =>
	Effect.catchCause(effect, (cause) => {
		const error = Cause.squash(cause);
		if (error instanceof UiError && when(error)) return recover(error);
		return error instanceof UiError
			? Effect.fail(error)
			: Effect.sync(() => {
					throw error;
				});
	});

/** The put of one user action, retried safely. A config PUT has no `Idempotency-Key`; it is idempotent by what it
 * carries: the same `verifiedHash` (the hash of the value) over the same `If-Match` either lands once or is refused
 * with 412. So a retry after a try whose answer was lost (network, 503, 5xx, 429: it may have landed) can meet that 412
 * for its own write; then the object is read, and when its ETag is the `verifiedHash` the write is already in: the
 * retry succeeds with `changed: false`. A 412 on a first try, or when the stored object is anything else, is the
 * person's real conflict and stays one. Build this once per action and retry that same effect (the flag lives in it). */
export const putOnce = <Name extends ConfigName>(
	client: ConfigApi,
	school: string,
	name: Name,
	value: ConfigValues[Name],
	verifiedHash: string,
	baseEtag: string | null,
): Effect.Effect<ConfigPut, UiError> => {
	let outcomeUnknown = false;
	const attempt = client.put(school, name, value, verifiedHash, baseEtag).pipe(
		Effect.tapError((error) =>
			Effect.sync(() => {
				if (error.retryable) outcomeUnknown = true;
			}),
		),
	);
	return recoverFrom(
		attempt,
		(error) => outcomeUnknown && error.detail.code === "stale_etag",
		(conflict) =>
			recoverFrom(
				client.get(school, name).pipe(
					Effect.flatMap((current) =>
						current.etag === verifiedHash
							? Effect.succeed<ConfigPut>({
									name,
									sha256: verifiedHash,
									bytes: 0,
									changed: false,
								})
							: Effect.fail(conflict),
					),
				),
				() => true,
				() => Effect.fail(conflict),
			),
	);
};
