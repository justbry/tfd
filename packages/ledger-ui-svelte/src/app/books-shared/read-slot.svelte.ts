import type { Effect } from "effect";
import type { AppServices } from "../../effect/app-layer.ts";
import type { UiError } from "../../effect/ui-error.ts";
import type { AppContext } from "../context.ts";
import { type RetryingRead, retryingRead } from "../retrying-read.ts";

/** One independent read of a pane (S9-plan section 5): its value and its failure, each tagged with the key the read was
 * made for (so that the answer of another school, period or audience is never shown for this one), whether a try is on
 * its way, and the read itself, which carries its own toast owner (`retryingRead`). `begin` starts it and hands back
 * how to let it go: leaving makes no toast and no log entry, and a Retry clicked later does nothing. */
export class ReadSlot<Value> {
	#loaded = $state.raw<{ key: string; value: Value } | null>(null);
	#failure = $state.raw<{ key: string; error: UiError } | null>(null);
	#busy = $state(false);
	#reading: RetryingRead | null = null;

	get busy(): boolean {
		return this.#busy;
	}
	valueFor(key: string): Value | null {
		return this.#loaded?.key === key ? this.#loaded.value : null;
	}
	failureFor(key: string): UiError | null {
		return this.#failure?.key === key ? this.#failure.error : null;
	}
	/** Whether the read has an answer for `key`, a value or a failure. */
	settledFor(key: string): boolean {
		return this.valueFor(key) !== null || this.failureFor(key) !== null;
	}
	/** Reads again (the pane's Retry). */
	retry = (): void => {
		void this.#reading?.run();
	};
	begin(
		context: AppContext,
		key: string,
		load: () => Effect.Effect<Value, UiError, AppServices>,
	): () => void {
		const reading = retryingRead(context, load, {
			value: (value) => {
				this.#loaded = { key, value };
				this.#failure = null;
			},
			failure: (error) => {
				this.#failure = { key, error };
			},
			busy: (busy) => {
				this.#busy = busy;
			},
		});
		this.#reading = reading;
		void reading.run();
		return () => {
			reading.cancel();
			if (this.#reading === reading) this.#reading = null;
			this.#failure = null;
		};
	}
}
