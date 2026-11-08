import { Effect } from "effect";
import type { Toasts } from "../effect/services.ts";
import { emptyToastState, type ToastState } from "../effect/toast-model.ts";

/** The Svelte 5 rune store over the `Toasts` service: `state` follows the service's queue; `dismiss` goes back to
 * it. */
export class ToastStore {
	state: ToastState = $state(emptyToastState);
	readonly #toasts: Toasts["Service"];
	readonly #stop: () => void;

	constructor(toasts: Toasts["Service"]) {
		this.#toasts = toasts;
		this.#stop = toasts.subscribe((next) => {
			this.state = next;
		});
	}

	dismiss(id: string): void {
		Effect.runFork(this.#toasts.dismiss(id));
	}

	/** Stops following the service (unmount). */
	close(): void {
		this.#stop();
	}
}
