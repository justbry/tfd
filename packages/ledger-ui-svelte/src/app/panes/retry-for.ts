import { messageFor } from "../../effect/messages.ts";
import type { UiError } from "../../effect/ui-error.ts";

/** What a pane gives `LoadFailed` for Retry: `retry` where the message table says retrying helps for this failure, else
 * nothing (a call that is not built, or a refusal, stays refused however often it is asked). */
export const retryFor = (
	error: UiError,
	retry: () => void,
): (() => void) | undefined =>
	messageFor(error).action === "retry" ? retry : undefined;
