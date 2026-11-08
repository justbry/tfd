import type { Effect } from "effect";
import type { AppServices } from "../effect/app-layer.ts";
import { type Attempted, withRetry } from "../effect/retry.ts";
import { Log, Toasts } from "../effect/services.ts";
import { UiError } from "../effect/ui-error.ts";
import { type AppContext, perform } from "./context.ts";

export type RetryingRead = {
	/** Runs the read; while a try is on its way another call does nothing (its toast's Retry says it is busy). */
	run: () => Promise<void>;
	/** The screen no longer wants this read (another school, an unmount): the run on its way is interrupted (its
	 * retries and waits stop, its retry toast leaves), its failure toast leaves, and a Retry clicked later does
	 * nothing. A cancelled run calls none of `on`, `busy(false)` included, so a `busy` callback shared with a newer
	 * read is never cleared by an old one. */
	cancel: () => void;
};

/** What the screen shows when a run is interrupted by something other than `cancel`: a failure it can retry. */
const interruptedWithoutCancel = new UiError({
	kind: "unexpected",
	detail: {},
	reason: "The read was interrupted before it finished.",
	retryable: true,
});

/** Each read's own name for its toasts (`ToastInput.owner`). */
let readsMade = 0;

/** A read a screen shows (S9-plan section 5): tried under the read retry rule; a failure is toasted with Retry (the
 * same read again) and Reload, and handed to the screen to show in place. One failure is one toast, owned by this
 * read: a run shows its progress there while it is on screen (else in a retry toast of its own), a later success
 * takes it down, a failure the same way merges into it (its count up), a different failure replaces it.
 * Another read's toasts are never touched, even with the same words. */
export function retryingRead<A>(
	context: AppContext,
	load: () => Effect.Effect<A, UiError, AppServices>,
	on: {
		value: (value: A) => void;
		failure?: (error: UiError) => void;
		busy?: (busy: boolean) => void;
	},
	/** What is tried: a read (the default), or a write with the `Idempotency-Key` of its action, so that the retry
	 * rule lets it try again and the Retry the toast offers sends the same request. */
	attempted: Attempted = { kind: "read" },
): RetryingRead {
	readsMade += 1;
	const owner = `read-${readsMade}`;
	/** The run on its way, if any. */
	let running: AbortController | null = null;
	let cancelled = false;
	/** This read's failure toast, while it is in the queue. */
	let failureToast: string | null = null;
	/** Whether a toast is still in the queue, on screen or waiting. */
	const queued = (id: string): boolean => {
		const { visible, waiting } = context.toasts.state;
		return [...visible, ...waiting].some((toast) => toast.id === id);
	};
	const markBusy = (id: string, busy: boolean): void => {
		context.runtime.runFork(
			Toasts.use((toasts) => toasts.update(id, { busy })),
		);
	};
	/** The read's failure toast is now `next`: the previous one leaves unless it is that same, merged toast. */
	const settle = (next: string | null): void => {
		if (failureToast !== null && failureToast !== next)
			context.toasts.dismiss(failureToast);
		failureToast = next;
	};
	const run = async (): Promise<void> => {
		if (running || cancelled) return;
		// A toast dismissed by hand is no longer this read's to settle.
		if (failureToast !== null && !queued(failureToast)) failureToast = null;
		const progressIn = failureToast ?? undefined;
		const controller = new AbortController();
		running = controller;
		on.busy?.(true);
		if (failureToast !== null) markBusy(failureToast, true);
		const outcome = await perform(
			context,
			withRetry(load(), attempted, {
				owner,
				...(progressIn === undefined ? {} : { progressIn }),
			}),
			{
				handlers: { retry: run, reload: () => window.location.reload() },
				owner,
				signal: controller.signal,
			},
		);
		running = null;
		if (cancelled) {
			// The cancel landed after the failure was reported: that toast speaks for nobody now.
			if (!outcome.ok && !outcome.interrupted && outcome.toastId !== null)
				context.toasts.dismiss(outcome.toastId);
			return;
		}
		if (outcome.ok) {
			settle(null);
			on.busy?.(false);
			on.value(outcome.value);
		} else if (!outcome.interrupted) {
			settle(outcome.toastId);
			if (outcome.toastId !== null) markBusy(outcome.toastId, false);
			on.busy?.(false);
			on.failure?.(outcome.error);
		} else {
			// Interrupted, yet not by `cancel`: the screen would be left with no value, no failure and no toast.
			if (failureToast !== null) markBusy(failureToast, false);
			on.busy?.(false);
			on.failure?.(interruptedWithoutCancel);
			context.runtime.runFork(
				Log.use((log) =>
					log.write({
						level: "warning",
						message: interruptedWithoutCancel.reason,
					}),
				),
			);
		}
	};
	const cancel = (): void => {
		cancelled = true;
		running?.abort();
		settle(null);
	};
	return { run, cancel };
}
