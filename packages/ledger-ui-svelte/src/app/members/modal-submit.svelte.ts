import type { AppContext } from "../context.ts";
import { retryingWrite } from "../panes/writes.ts";
import type { RetryingRead } from "../retrying-read.ts";
import type { Applied } from "./members-model.ts";
import type { WriteContext } from "./members-writes.ts";
import type { ModalContext } from "./modal-context.ts";

/** Runs a modal's write through the Effect layer: the modal stays open and busy until the Writer answers, then hands
 * the effect to the tab. A failure is a toast with Retry (the same request, the same `Idempotency-Key`) and the modal
 * stays open, its button ready again, so that it can be sent again; closing the modal takes the toast down. */
export class Submitter {
	busy = $state(false);
	#writing: RetryingRead | null = null;
	constructor(
		private readonly app: AppContext,
		private readonly context: () => ModalContext,
	) {}
	run(send: (write: WriteContext) => Promise<Applied>): void {
		this.#writing?.cancel();
		const writing = retryingWrite(
			this.app,
			(writer) => send({ ...this.context().write, writer }),
			{
				value: (applied) => this.context().onDone(applied),
				failure: () => {
					this.busy = false;
				},
				busy: (next) => {
					this.busy = next;
				},
			},
		);
		this.#writing = writing;
		this.busy = true;
		writing.run();
	}
	/** The modal is gone: its failure toast goes with it. */
	cancel(): void {
		this.#writing?.cancel();
	}
}
