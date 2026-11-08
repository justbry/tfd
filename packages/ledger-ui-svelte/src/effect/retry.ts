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

export type RetryOptions = {
	baseMilliseconds?: number;
	/** Whose retry toast it is (`ToastInput.owner`): another read's identical retry never merges into it. */
	owner?: string;
	/** The id of this failure's toast (its Retry started this run): at each step, while that toast is on screen, the
	 * progress shows in it (`ToastInput.progress`) instead of in a second toast; while it waits behind others, or once
	 * it is dismissed, the run shows its own retry toast. Its progress is cleared when the run ends without a value
	 * (a failure, which then merges back into it, or an interruption). On success the caller takes it down. */
	progressIn?: string;
};

/** Runs `effect`, trying again while `mayRetry` allows and fewer than three tries have run. While it retries, one
 * toast on screen says so ("Retrying (2 of 3)", then "(3 of 3)"): the failure toast `progressIn` when it is on screen
 * at that step, else the run's own retry toast, made when first needed and taken down when the effect ends either
 * way, interrupted included. The caller reports a final failure. The toast work is not interruptible, so an
 * interruption never strands a retry toast whose id was not yet kept. */
export const withRetry = <A, R>(
	effect: Effect.Effect<A, UiError, R>,
	attempted: Attempted,
	options: RetryOptions = {},
): Effect.Effect<A, UiError, R | Toasts> =>
	Effect.gen(function* () {
		const toasts = yield* Toasts;
		let tries = 1;
		let toastId: string | null = null;
		const { progressIn, owner } = options;
		/** Whether a toast is on screen now (`subscribe` hands the current state at once). */
		const onScreen = (id: string): boolean => {
			let shown = false;
			toasts.subscribe((state) => {
				shown = state.visible.some((toast) => toast.id === id);
			})();
			return shown;
		};
		const ownToastLeaves = Effect.suspend(() => {
			if (toastId === null) return Effect.void;
			const leaving = toastId;
			toastId = null;
			return toasts.dismiss(leaving);
		});
		const tryAgain = (error: UiError): Effect.Effect<boolean> =>
			Effect.uninterruptible(
				Effect.gen(function* () {
					if (!mayRetry(error, attempted) || tries >= maximumTries)
						return false;
					tries += 1;
					const progress = retryingText(tries);
					if (progressIn !== undefined && onScreen(progressIn)) {
						yield* toasts.update(progressIn, { progress });
						yield* ownToastLeaves;
					} else if (toastId === null)
						toastId = yield* toasts.show({
							tone: "info",
							sticky: true,
							title: messageFor(error).title,
							detail: progress,
							...(owner === undefined ? {} : { owner }),
						});
					else yield* toasts.update(toastId, { detail: progress });
					return true;
				}),
			);
		const progressCleared = Effect.suspend(() =>
			progressIn === undefined
				? Effect.void
				: toasts.update(progressIn, { progress: "" }),
		);
		return yield* effect.pipe(
			Effect.retry({
				schedule: retrySchedule(
					options.baseMilliseconds ?? defaultBaseMilliseconds,
				),
				while: tryAgain,
			}),
			Effect.onError(() => progressCleared),
			Effect.ensuring(ownToastLeaves),
		);
	});
