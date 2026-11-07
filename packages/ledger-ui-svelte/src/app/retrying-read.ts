import type { Effect } from "effect";
import type { AppServices } from "../effect/app-layer.ts";
import { withRetry } from "../effect/retry.ts";
import type { UiError } from "../effect/ui-error.ts";
import { type AppContext, perform } from "./context.ts";

/** A read a screen shows (S9-plan section 5): tried under the read retry rule; a failure is toasted with Retry (the
 * same read again) and Reload, and handed to the screen to show in place; a later success takes that toast down,
 * since the failure it reported is fixed. One try runs at a time. */
export function retryingRead<A>(
	context: AppContext,
	load: () => Effect.Effect<A, UiError, AppServices>,
	on: {
		value: (value: A) => void;
		failure?: (error: UiError) => void;
		busy?: (busy: boolean) => void;
	},
): () => Promise<void> {
	let running = false;
	let failureToast: string | null = null;
	const settle = (next: string | null): void => {
		if (failureToast !== null) context.toasts.dismiss(failureToast);
		failureToast = next;
	};
	const run = async (): Promise<void> => {
		if (running) return;
		running = true;
		on.busy?.(true);
		const outcome = await perform(
			context,
			withRetry(load(), { kind: "read" }),
			{ retry: run, reload: () => window.location.reload() },
		);
		running = false;
		on.busy?.(false);
		if (outcome.ok) {
			settle(null);
			on.value(outcome.value);
		} else {
			settle(outcome.toastId);
			on.failure?.(outcome.error);
		}
	};
	return run;
}
