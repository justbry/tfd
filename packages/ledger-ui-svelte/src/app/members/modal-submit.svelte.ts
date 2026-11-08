import type { AppContext } from "../context.ts";
import { retryingWrite } from "../panes/writes.ts";
import type { Applied } from "./members-model.ts";
import type { WriteContext } from "./members-writes.ts";
import type { ModalContext } from "./modal-context.ts";

/** Runs a modal's write through the Effect layer: the modal stays open and busy until the Writer answers, then hands
 * the effect to the tab. A failure is a toast with Retry (the same request, the same `Idempotency-Key`) and the modal
 * stays open, its button ready again, so that it can be sent again; the toast outlives the modal. */
export class Submitter {
	busy = $state(false);
	constructor(
		private readonly app: AppContext,
		private readonly context: () => ModalContext,
	) {}
	/** Sends the write for the school and the person the modal was opened for (a snapshot at the click: a retry from
	 * the toast sends the same request to the same school, whatever the app shows by then). The write is never
	 * aborted: once sent it may be at the server, so closing the modal leaves it running. */
	run(send: (write: WriteContext) => Promise<Applied>): void {
		const { write, onDone } = this.context();
		this.busy = true;
		retryingWrite(this.app, (writer) => send({ ...write, writer }), {
			value: (applied) => onDone(applied, write.schoolId),
			failure: () => {
				this.busy = false;
			},
			busy: (next) => {
				this.busy = next;
			},
		}).run();
	}
}
