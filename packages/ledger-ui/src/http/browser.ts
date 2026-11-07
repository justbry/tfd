import { mountApp } from "../app/mount.tsx";
import type { DownloadFile } from "../data/ledger.ts";
import type { Reader } from "../data/reader.ts";
import type { Clock, School } from "../data/types.ts";
import { createHttpAdapters } from "./adapters.ts";
import { memoryStorage, type StorageLike } from "./pending.ts";
import { localWallTime } from "./school-routes.ts";
import { timerScheduler } from "./transport.ts";
import { notConnectedWorker } from "./worker-source.ts";
import type { FileSaver } from "./writer.ts";

const millisecondsPerSecond = 1000;

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

/** The HTTP build's clock (protocol §3: the entry supplies it, the UI never reads the system time): `seconds` as the
 * wall time of `timeZone`. */
export function clockAt(seconds: number, timeZone: string): Clock {
	const now = localWallTime(seconds, timeZone);
	return { today: now.slice(0, 10), now };
}

/** The browser's persistent storage, so the pending writes survive a reload; a page that may not use it keeps them in
 * memory. */
function pendingStorage(): StorageLike {
	try {
		return window.localStorage;
	} catch {
		return memoryStorage();
	}
}

/**
 * The HTTP build (`VITE_LEDGER_SOURCE=http`, `VITE_API_BASE`): buzz-school's routes on `apiBase`, the ledger Worker
 * not connected yet (S8e part 2). Gate H allows this file alone the browser's persistent storage and one system clock
 * read: the pending store lives in `localStorage`, and the clock is the instant of the mount as the wall time of the
 * first school's time zone (the browser's when there is no school). The schools read for that zone is the one the
 * app then shows. No PIN dialog is wired for the writes that do not collect one: such a write that answers
 * `pin_required` rejects `pin_required`.
 */
export function mountHttpApp(
	root: HTMLElement,
	options: { apiBase: string },
): void {
	const mountedAt = Date.now() / millisecondsPerSecond;
	const { reader, writer } = createHttpAdapters({
		fetch: (url, init) => fetch(url, init),
		apiBase: options.apiBase,
		scheduler: timerScheduler,
		storage: pendingStorage(),
		newKey: () => crypto.randomUUID(),
		worker: () => notConnectedWorker(),
		files: browserFileSaver(root.ownerDocument),
	});
	let firstSchools: Promise<School[]> | undefined = reader.schools();
	const sharedReader: Reader = {
		...reader,
		schools: () => {
			const answer = firstSchools ?? reader.schools();
			firstSchools = undefined;
			return answer;
		},
	};
	firstSchools
		.then(
			(schools) => schools[0]?.timeZone,
			() => undefined,
		)
		.then((timeZone) =>
			mountApp(root, {
				reader: sharedReader,
				writer,
				clock: clockAt(
					mountedAt,
					timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
				),
			}),
		);
}
