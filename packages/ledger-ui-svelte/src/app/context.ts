import { Cause, Effect, type ManagedRuntime } from "effect";
import { getContext, setContext } from "svelte";
import type { Clock as CalendarClock } from "$contract/data/types.ts";
import type { AppServices } from "../effect/app-layer.ts";
import { type ActionHandlers, reportFailure } from "../effect/report.ts";
import { Log } from "../effect/services.ts";
import { toUiError, UiError } from "../effect/ui-error.ts";
import type { ToastStore } from "./toast-store.svelte.ts";

/** What every component of the app reaches: the Effect runtime of the app's layer, the toast store, the calendar
 * and the app's frame (where the settings sheet hangs). */
export type AppContext = {
	root: HTMLElement;
	runtime: ManagedRuntime.ManagedRuntime<AppServices, never>;
	toasts: ToastStore;
	calendar: CalendarClock;
};

const key = Symbol("ledger-ui-svelte");

export const provideApp = (context: AppContext): AppContext =>
	setContext(key, context);

export function useApp(): AppContext {
	const context = getContext<AppContext | undefined>(key);
	if (!context)
		throw new Error("the app context is missing: mount with mountApp");
	return context;
}

/** A run's end: its value, or its error and the toast that reported it (so that a later success can take the toast
 * down: errors stay until dismissed or fixed). */
export type Outcome<A> =
	| { ok: true; value: A }
	| { ok: false; error: UiError; toastId: string };

/** The `UiError` a failed run ends with: its typed failure, or for a defect (a bug in an adapter, an interrupted
 * fiber) an `unexpected` one, written to the log since nothing upstream did. */
const uiErrorOf = (
	cause: Cause.Cause<UiError>,
): Effect.Effect<UiError, never, Log> => {
	const squashed = Cause.squash(cause);
	if (squashed instanceof UiError) return Effect.succeed(squashed);
	const error = toUiError(squashed);
	return Effect.as(
		Log.use((log) =>
			log.write({ level: "error", message: error.reason, cause: squashed }),
		),
		error,
	);
};

/** Runs an effect of the app; any failure, typed or a defect, is shown as a toast (with the handlers the screen
 * offers) and returned, so the screen can show the same message in place. The promise never rejects: nothing fails
 * silently. */
export const perform = <A>(
	{ runtime }: Pick<AppContext, "runtime">,
	effect: Effect.Effect<A, UiError, AppServices>,
	handlers: ActionHandlers = {},
): Promise<Outcome<A>> =>
	runtime.runPromise(
		effect.pipe(
			Effect.map((value): Outcome<A> => ({ ok: true, value })),
			Effect.catchCause((cause) =>
				Effect.flatMap(uiErrorOf(cause), (error) =>
					Effect.map(
						reportFailure(error, handlers),
						(toastId): Outcome<A> => ({ ok: false, error, toastId }),
					),
				),
			),
		),
	);
