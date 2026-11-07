import type { Effect } from "effect";
import { actionLabels, type MessageAction, messageFor } from "./messages.ts";
import { Toasts } from "./services.ts";
import type { ToastTone } from "./toast-model.ts";
import type { UiError, UiErrorKind } from "./ui-error.ts";

/** Kinds that say "not here yet" rather than "this failed": a warning, which also stays until dismissed. */
const warningKinds: ReadonlySet<UiErrorKind> = new Set([
	"no_data",
	"not_available",
	"not_connected",
]);

const toneOf = (error: UiError): ToastTone =>
	warningKinds.has(error.kind) ? "warning" : "error";

/** What the screen can do for each action; a toast shows the message's action only when the screen gave it. */
export type ActionHandlers = Partial<Record<MessageAction, () => void>>;

/** Shows a failure as a toast from the message table: title, what happened, what to do, and its action. A field
 * problem also shows at the field (`InlineError`); the toast carries the summary. */
export const reportFailure = (
	error: UiError,
	handlers: ActionHandlers = {},
): Effect.Effect<string, never, Toasts> => {
	const message = messageFor(error);
	const handler = message.action ? handlers[message.action] : undefined;
	return Toasts.use((toasts) =>
		toasts.show({
			tone: toneOf(error),
			title: message.title,
			detail: message.what,
			doThis: message.doThis,
			...(message.action && handler
				? { action: { label: actionLabels[message.action], run: handler } }
				: {}),
		}),
	);
};
