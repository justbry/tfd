import type { Effect } from "effect";
import type { AppServices } from "../effect/app-layer.ts";
import { messageFor } from "../effect/messages.ts";
import { withRetry } from "../effect/retry.ts";
import type { UiError } from "../effect/ui-error.ts";
import { type AppContext, perform } from "./context.ts";

export type RetryingRead = {
	/** Runs the read; while a try is on its way another call does nothing. */
	run: () => Promise<void>;
	/** The screen no longer wants this read (another school, an unmount): the run on its way is interrupted (its
	 * retries and waits stop, its retry toast leaves), its failure toast leaves, and a Retry clicked later does
	 * nothing. */
	cancel: () => void;
};

/** Each read's own name for its toasts (`ToastInput.owner`). */
let readsMade = 0;

/** A read a screen shows (S9-plan section 5): tried under the read retry rule; a failure is toasted with Retry (the
 * same read again) and Reload, and handed to the screen to show in place. One failure is one toast, owned by this
 * read: a Retry shows its progress in that toast's second line, a later success takes it down, a failure the same way
 * merges into it (its count up), a different failure replaces it. Another read's toasts are never touched, even with
 * the same words. */
export function retryingRead<A>(
	context: AppContext,
	load: () => Effect.Effect<A, UiError, AppServices>,
	on: {
		value: (value: A) => void;
		failure?: (error: UiError) => void;
		busy?: (busy: boolean) => void;
	},
): RetryingRead {
	readsMade += 1;
	const owner = `read-${readsMade}`;
	/** The run on its way, if any. */
	let running: AbortController | null = null;
	let cancelled = false;
	/** This read's failure toast and its own second line. */
	let failure: { id: string; detail: string } | null = null;
	/** The read's failure toast is now `next`: the previous one leaves unless it is that same, merged toast. */
	const settle = (next: { id: string; detail: string } | null): void => {
		if (failure !== null && failure.id !== next?.id)
			context.toasts.dismiss(failure.id);
		failure = next;
	};
	const run = async (): Promise<void> => {
		if (running || cancelled) return;
		const controller = new AbortController();
		running = controller;
		on.busy?.(true);
		const outcome = await perform(
			context,
			withRetry(
				load(),
				{ kind: "read" },
				{ owner, ...(failure ? { progressIn: failure } : {}) },
			),
			{
				handlers: { retry: run, reload: () => window.location.reload() },
				owner,
				signal: controller.signal,
			},
		);
		running = null;
		if (cancelled) {
			// The cancel landed after the failure was reported: that toast speaks for nobody now.
			if (!outcome.ok && !outcome.interrupted)
				context.toasts.dismiss(outcome.toastId);
			return;
		}
		on.busy?.(false);
		if (outcome.ok) {
			settle(null);
			on.value(outcome.value);
		} else if (!outcome.interrupted) {
			settle({ id: outcome.toastId, detail: messageFor(outcome.error).what });
			on.failure?.(outcome.error);
		}
	};
	const cancel = (): void => {
		cancelled = true;
		running?.abort();
		settle(null);
	};
	return { run, cancel };
}
