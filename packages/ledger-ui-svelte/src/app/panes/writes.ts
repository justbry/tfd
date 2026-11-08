import { write } from "../../effect/run.ts";
import type { Writer } from "../../effect/services.ts";
import { Toasts } from "../../effect/services.ts";
import type { ToastInput } from "../../effect/toast-model.ts";
import type { UiError } from "../../effect/ui-error.ts";
import type { AppContext } from "../context.ts";
import { type RetryingRead, retryingRead } from "../retrying-read.ts";

/** One user action's `Idempotency-Key` as the UI sees it: a name for the action that lives as long as the action
 * does. The HTTP adapter keeps the real header in its pending store and sends the same one again for the same
 * request (packages/ledger-ui/src/http/pending.ts `begin`), so a retry of this action, from the toast or from the
 * button, sends the same request and the server answers the first result instead of acting twice. A write the UI
 * has no such name for is never retried (`mayRetry`). */
export const newActionKey = (): string => crypto.randomUUID();

export type WriteOutcome<A> = {
	value: (value: A) => void;
	failure?: (error: UiError) => void;
	busy?: (busy: boolean) => void;
};

/** A write of the Writer, run through the app's Effect layer (S9-plan section 5): tried under the write retry rule
 * (only with its action key, at most three tries), a failure is a toast with Retry (the same request again) and is
 * handed to the screen to show in place, a later success takes the toast down. Each write has its own toast owner,
 * so another write's identical failure never merges into it. `cancel` lets it go: no toast stays. */
export function retryingWrite<A>(
	context: AppContext,
	send: (writer: Writer["Service"]) => Promise<A>,
	on: WriteOutcome<A>,
	key: string = newActionKey(),
): RetryingRead {
	return retryingRead(context, () => write(send), on, {
		kind: "write",
		idempotencyKey: key,
	});
}

/** Shows a toast of the screen's own (a success: sent, resent, downloaded). */
export const notify = (context: AppContext, toast: ToastInput): void => {
	context.runtime.runFork(Toasts.use((toasts) => toasts.show(toast)));
};
export const notifySuccess = (context: AppContext, title: string): void =>
	notify(context, { tone: "success", title });
