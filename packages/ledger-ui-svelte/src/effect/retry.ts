import { Effect, Schedule } from "effect";
import { messageFor } from "./messages.ts";
import { Toasts } from "./services.ts";
import type { UiError } from "./ui-error.ts";

/** At most three tries in all: the first and two retries (S9-plan section 5). */
export const maximumTries = 3;
const defaultBaseMilliseconds = 400;

/** What is being tried. A write is retried only with the `Idempotency-Key` it was first sent with, so the server can
 * tell a retry from a second change. */
export type Attempted =
	| { kind: "read" }
	| { kind: "write"; idempotencyKey: string | null };

/** Whether a failure may be tried again: only a kind the adapter marks retryable, and never a write without a key. */
export const mayRetry = (error: UiError, attempted: Attempted): boolean =>
	error.retryable &&
	(attempted.kind === "read" || Boolean(attempted.idempotencyKey));

/** Exponential backoff with jitter: each wait about twice the last, each moved by up to a fifth either way. */
const retrySchedule = (baseMilliseconds: number) =>
	Schedule.jittered(Schedule.exponential(baseMilliseconds));

export const retryingText = (attempt: number): string =>
	`Retrying (${attempt} of ${maximumTries})`;

/** Runs `effect`, trying again while `mayRetry` allows and fewer than three tries have run. While it retries, one
 * toast says so ("Retrying (2 of 3)", then "(3 of 3)"); it leaves when the effect ends either way, and the caller
 * reports a final failure. */
export const withRetry = <A, R>(
	effect: Effect.Effect<A, UiError, R>,
	attempted: Attempted,
	options: { baseMilliseconds?: number } = {},
): Effect.Effect<A, UiError, R | Toasts> =>
	Effect.gen(function* () {
		const toasts = yield* Toasts;
		let tries = 1;
		let toastId: string | null = null;
		const tryAgain = (error: UiError): Effect.Effect<boolean> =>
			Effect.gen(function* () {
				if (!mayRetry(error, attempted) || tries >= maximumTries) return false;
				tries += 1;
				const detail = retryingText(tries);
				if (toastId === null)
					toastId = yield* toasts.show({
						tone: "info",
						sticky: true,
						title: messageFor(error).title,
						detail,
					});
				else yield* toasts.update(toastId, { detail });
				return true;
			});
		return yield* effect.pipe(
			Effect.retry({
				schedule: retrySchedule(
					options.baseMilliseconds ?? defaultBaseMilliseconds,
				),
				while: tryAgain,
			}),
			Effect.ensuring(
				Effect.suspend(() =>
					toastId === null ? Effect.void : toasts.dismiss(toastId),
				),
			),
		);
	});
