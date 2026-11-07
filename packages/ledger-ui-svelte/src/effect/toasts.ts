import { Effect, Fiber, Layer, Ref } from "effect";
import { Clock, Toasts } from "./services.ts";
import {
	addToast,
	autoDismissMilliseconds,
	dismissToast,
	emptyToastState,
	findToast,
	staysUntilDismissed,
	type Toast,
	type ToastState,
	updateToast,
} from "./toast-model.ts";

/** The `Toasts` service: the queue's state in a `Ref`, an auto-dismiss fiber per success or info toast on screen
 * (started when it comes on screen, restarted when an identical message merges into it), and listeners for the
 * Svelte rune store. A toast waiting behind four others does not count down. */
export const toastsLayer = Layer.effect(
	Toasts,
	Effect.gen(function* () {
		const clock = yield* Clock;
		const state = yield* Ref.make<ToastState>(emptyToastState);
		let latest: ToastState = emptyToastState;
		const listeners = new Set<(next: ToastState) => void>();
		const timers = new Map<string, Fiber.Fiber<void>>();

		const publish = (next: ToastState): Effect.Effect<void> =>
			Effect.andThen(
				Ref.set(state, next),
				Effect.sync(() => {
					latest = next;
					for (const listener of listeners) listener(next);
				}),
			);

		const stopTimer = (id: string): Effect.Effect<void> =>
			Effect.suspend(() => {
				const fiber = timers.get(id);
				timers.delete(id);
				return fiber ? Fiber.interrupt(fiber) : Effect.void;
			});

		const removeNow = (id: string): Effect.Effect<void> =>
			Effect.gen(function* () {
				const { state: next, promoted } = dismissToast(
					yield* Ref.get(state),
					id,
				);
				yield* publish(next);
				for (const toast of promoted) yield* startTimer(toast);
			});

		function startTimer(toast: Toast): Effect.Effect<void> {
			return Effect.gen(function* () {
				yield* stopTimer(toast.id);
				if (staysUntilDismissed(toast)) return;
				const fiber = yield* Effect.forkDetach(
					clock.sleep(autoDismissMilliseconds).pipe(
						Effect.andThen(
							Effect.sync(() => {
								timers.delete(toast.id);
							}),
						),
						Effect.andThen(removeNow(toast.id)),
					),
				);
				timers.set(toast.id, fiber);
			});
		}

		return Toasts.of({
			show: (input) =>
				Effect.gen(function* () {
					const added = addToast(yield* Ref.get(state), input);
					yield* publish(added.state);
					const toast = findToast(added.state, added.id);
					if (added.shown && toast) yield* startTimer(toast);
					return added.id;
				}),
			update: (id, patch) =>
				Effect.gen(function* () {
					const next = updateToast(yield* Ref.get(state), id, patch);
					yield* publish(next);
					const toast = next.visible.find((candidate) => candidate.id === id);
					if (toast) yield* startTimer(toast);
				}),
			dismiss: (id) => Effect.andThen(stopTimer(id), removeNow(id)),
			state: Ref.get(state),
			current: () => latest,
			subscribe: (listener) => {
				listeners.add(listener);
				listener(latest);
				return () => {
					listeners.delete(listener);
				};
			},
		});
	}),
);
