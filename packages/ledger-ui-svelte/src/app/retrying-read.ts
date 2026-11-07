import type { Effect } from "effect";
import type { AppServices } from "../effect/app-layer.ts";
import { withRetry } from "../effect/retry.ts";
import type { UiError } from "../effect/ui-error.ts";
import { type AppContext, perform } from "./context.ts";

export type RetryingRead = {
	/** Runs the read; while a try is on its way another call does nothing. */
	run: () => Promise<void>;
	/** The screen no longer wants this read (another school, an unmount): its failure toast leaves, and neither a try
	 * still on its way nor a Retry clicked later can run or report. */
	cancel: () => void;
};

/** A read a screen shows (S9-plan section 5): tried under the read retry rule; a failure is toasted with Retry (the
 * same read again) and Reload, and handed to the screen to show in place. The toast stays until the failure is fixed:
 * a later success takes it down, a failure the same way merges into it (the same toast, its count up), a different
 * failure replaces it. */
export function retryingRead<A>(
	context: AppContext,
	load: () => Effect.Effect<A, UiError, AppServices>,
	on: {
		value: (value: A) => void;
		failure?: (error: UiError) => void;
		busy?: (busy: boolean) => void;
	},
): RetryingRead {
	let running = false;
	let cancelled = false;
	let failureToast: string | null = null;
	/** The read's failure toast is now `next`: the previous one leaves unless it is that same, merged toast. */
	const settle = (next: string | null): void => {
		if (failureToast !== null && failureToast !== next)
			context.toasts.dismiss(failureToast);
		failureToast = next;
	};
	const run = async (): Promise<void> => {
		if (running || cancelled) return;
		running = true;
		on.busy?.(true);
		const outcome = await perform(
			context,
			withRetry(load(), { kind: "read" }),
			{ retry: run, reload: () => window.location.reload() },
			() => !cancelled,
		);
		running = false;
		if (cancelled) return;
		on.busy?.(false);
		if (outcome.ok) {
			settle(null);
			on.value(outcome.value);
		} else {
			settle(outcome.toastId);
			on.failure?.(outcome.error);
		}
	};
	const cancel = (): void => {
		cancelled = true;
		settle(null);
	};
	return { run, cancel };
}
