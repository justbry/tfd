import type { Writer } from "../../effect/services.ts";
import type { UiError } from "../../effect/ui-error.ts";
import type { AppContext } from "../context.ts";
import { retryingWrite } from "../panes/writes.ts";

/** A dialog's write through the Effect layer (S9-plan section 5, the Members modals' `Submitter` for the Settings
 * dialogs): the dialog stays open and busy until the Writer answers; a failure is a toast with Retry (the same request,
 * the same `Idempotency-Key`) and also stays in the dialog, in the message table's words; the write is never aborted
 * (once sent it may be at the server), so closing the dialog leaves it running. `alive` goes false when the Settings
 * leave the screen: the answer then changes nothing and says nothing. */
export class DialogWrite {
	busy = $state(false);
	failure: UiError | null = $state.raw(null);
	#alive = true;
	constructor(private readonly app: AppContext) {}

	/** Sends the write built at the click (`send` closes over the school and the person's input at that moment). */
	run<A>(
		send: (writer: Writer["Service"]) => Promise<A>,
		onValue: (value: A) => void,
	): void {
		this.failure = null;
		this.busy = true;
		retryingWrite(this.app, send, {
			value: (value) => {
				this.busy = false;
				if (this.#alive) onValue(value);
			},
			failure: (error) => {
				this.busy = false;
				if (this.#alive) this.failure = error;
			},
			busy: (next) => {
				this.busy = next;
			},
		}).run();
	}

	leave(): void {
		this.#alive = false;
	}
}
