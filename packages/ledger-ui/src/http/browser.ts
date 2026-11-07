import { mountApp } from "../app/mount.tsx";
import type { DownloadFile } from "../data/ledger.ts";
import type { Clock } from "../data/types.ts";
import { createHttpAdapters } from "./adapters.ts";
import { memoryStorage } from "./pending.ts";
import { timerScheduler } from "./transport.ts";
import { notConnectedWorker } from "./worker-source.ts";
import type { FileSaver } from "./writer.ts";

/** The real Writer's download (ledger.ts `DownloadFile`): a Blob URL clicked through a hidden link. */
export function browserFileSaver(document: Document): FileSaver {
	return {
		save: async (file: DownloadFile) => {
			const url = URL.createObjectURL(
				new Blob([file.text], { type: file.type }),
			);
			const link = document.createElement("a");
			link.href = url;
			link.download = file.name;
			link.hidden = true;
			document.body.append(link);
			link.click();
			link.remove();
			URL.revokeObjectURL(url);
		},
	};
}

/**
 * The HTTP build (`VITE_LEDGER_SOURCE=http`, `VITE_API_BASE`): buzz-school's routes on `apiBase`, the ledger Worker
 * not connected yet (S8e part 2). Gate H keeps the browser's persistent storage out of `src/`, so the pending store lives in memory
 * here and does not survive a reload in this build until the orchestrator allows it (the store itself takes any
 * `Storage` and is tested across a reload). No PIN dialog is wired: a write that needs the PIN rejects `pin_required`.
 */
export function mountHttpApp(
	root: HTMLElement,
	options: { apiBase: string; clock: Clock },
): void {
	const { reader, writer } = createHttpAdapters({
		fetch: (url, init) => fetch(url, init),
		apiBase: options.apiBase,
		scheduler: timerScheduler,
		storage: memoryStorage(),
		newKey: () => crypto.randomUUID(),
		worker: () => notConnectedWorker(),
		files: browserFileSaver(root.ownerDocument),
	});
	mountApp(root, { reader, writer, clock: options.clock });
}
