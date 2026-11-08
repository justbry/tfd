import { Cause, Effect, Exit, type ManagedRuntime } from "effect";
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

/** A run's end: its value; or its error and the toast that reported it (so that a later success can take the toast
 * down: errors stay until dismissed or fixed); or `interrupted`, when the screen stopped it (no toast, nothing
 * logged: nobody wants that answer any more). */
export type Outcome<A> =
	| { ok: true; value: A }
	| { ok: false; interrupted: false; error: UiError; toastId: string }
	| { ok: false; interrupted: true };

const interrupted = { ok: false, interrupted: true } as const;

/** The `UiError` a failed run ends with: its typed failure, or for a defect (a bug in an adapter) an `unexpected`
 * one, written to the log since nothing upstream did. */
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

export type PerformOptions = {
	/** What the screen offers for the toast's action. */
	handlers?: ActionHandlers;
	/** Whose failure toast it is (`ToastInput.owner`). */
	owner?: string;
	/** Aborting it interrupts the run: retries and their waits stop, a call on its way is let go, the run's retry
	 * toast leaves, and the outcome is `interrupted`. */
	signal?: AbortSignal;
};

/** Runs an effect of the app; any failure, typed or a defect, is shown as a toast (with the handlers the screen
 * offers) and returned, so the screen can show the same message in place. The promise never rejects: nothing fails
 * silently. An interruption alone (the signal, or the effect stopping itself) is no failure: no toast, no log. The
 * report is not interruptible, so a toast it shows always comes back as `toastId`. */
export const perform = async <A>(
	{ runtime }: Pick<AppContext, "runtime">,
	effect: Effect.Effect<A, UiError, AppServices>,
	options: PerformOptions = {},
): Promise<Outcome<A>> => {
	/** The failure as reported, kept outside the fiber: an abort landing just after the toast showed still hands the
	 * toast back, so that the caller can take it down. */
	let reported: Outcome<A> | null = null;
	const exit = await runtime.runPromiseExit(
		effect.pipe(
			Effect.map((value): Outcome<A> => ({ ok: true, value })),
			Effect.catchCause((cause) =>
				Cause.hasInterruptsOnly(cause)
					? Effect.succeed<Outcome<A>>(interrupted)
					: Effect.uninterruptible(
							Effect.flatMap(uiErrorOf(cause), (error) =>
								Effect.map(
									reportFailure(error, options.handlers, options.owner),
									(toastId): Outcome<A> => {
										reported = {
											ok: false,
											interrupted: false,
											error,
											toastId,
										};
										return reported;
									},
								),
							),
						),
			),
		),
		options.signal ? { signal: options.signal } : undefined,
	);
	return Exit.isSuccess(exit) ? exit.value : (reported ?? interrupted);
};
