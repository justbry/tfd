import { Effect, type ManagedRuntime } from "effect";
import { getContext, setContext } from "svelte";
import type { Clock as CalendarClock } from "$contract/data/types.ts";
import type { AppServices } from "../effect/layers.ts";
import { type ActionHandlers, reportFailure } from "../effect/report.ts";
import type { UiError } from "../effect/ui-error.ts";
import type { ToastStore } from "./toast-store.svelte.ts";

/** What every component of the app reaches: the Effect runtime of the app's layer, the toast store and the
 * calendar. */
export type AppContext = {
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

export type Outcome<A> = { ok: true; value: A } | { ok: false; error: UiError };

/** Runs an effect of the app; a failure is shown as a toast (with the handlers the screen offers) and returned, so
 * the screen can show the same message in place. Nothing fails silently. */
export const perform = <A>(
	{ runtime }: AppContext,
	effect: Effect.Effect<A, UiError, AppServices>,
	handlers: ActionHandlers = {},
): Promise<Outcome<A>> =>
	runtime.runPromise(
		effect.pipe(
			Effect.map((value): Outcome<A> => ({ ok: true, value })),
			Effect.catch((error: UiError) =>
				Effect.as(reportFailure(error, handlers), {
					ok: false,
					error,
				} satisfies Outcome<A>),
			),
		),
	);
