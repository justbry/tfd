import { Toasts } from "../../effect/services.ts";
import type { ToastTone } from "../../effect/toast-model.ts";
import type { AppContext } from "../context.ts";

/** A line the pane says in a toast ("Draft discarded."): success and info leave on their own after five seconds. */
export const notify = (
	app: Pick<AppContext, "runtime">,
	title: string,
	tone: ToastTone = "info",
): void => {
	app.runtime.runFork(Toasts.use((toasts) => toasts.show({ tone, title })));
};

/** The title of a write control while previewing another audience (the Preact package's `exitPreviewTitle`). */
export const exitPreviewTitle = "Exit preview to act";
