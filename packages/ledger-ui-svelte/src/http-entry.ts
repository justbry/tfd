import type { DownloadFile } from "$contract/data/ledger.ts";
import type { Clock as CalendarClock } from "$contract/data/types.ts";
import { memoryStorage, type StorageLike } from "$contract/http/pending.ts";
import { localWallTime } from "$contract/http/school-routes.ts";
import type { FileSaver } from "$contract/http/writer.ts";
import { mountApp } from "./app/mount.ts";
import { httpLayer } from "./effect/layers.ts";

const millisecondsPerSecond = 1000;

/** A download: a Blob URL clicked through a hidden link (the Preact entry's `browserFileSaver`). */
const browserFileSaver = (document: Document): FileSaver => ({
	save: async (file: DownloadFile) => {
		const url = URL.createObjectURL(new Blob([file.text], { type: file.type }));
		const link = document.createElement("a");
		link.href = url;
		link.download = file.name;
		link.hidden = true;
		document.body.append(link);
		link.click();
		link.remove();
		URL.revokeObjectURL(url);
	},
});

/** The browser's persistent storage, so pending writes survive a reload; a page that may not use it keeps them in
 * memory. */
function pendingStorage(): StorageLike {
	try {
		return window.localStorage;
	} catch {
		return memoryStorage();
	}
}

/** The HTTP build's entry. Gate H allows this file alone the browser's persistent storage and one system clock
 * read: the calendar is the instant of the mount as the browser's wall time. */
export function mountHttpApp(
	root: HTMLElement,
	options: { apiBase: string; workerBase: string },
): void {
	const seconds = Date.now() / millisecondsPerSecond;
	const now = localWallTime(
		seconds,
		Intl.DateTimeFormat().resolvedOptions().timeZone,
	);
	const calendar: CalendarClock = { today: now.slice(0, 10), now };
	const browserFetch = (url: string, init: RequestInit) => fetch(url, init);
	mountApp(root, {
		calendar,
		layer: httpLayer({
			fetch: browserFetch,
			apiBase: options.apiBase,
			workerBase: options.workerBase,
			storage: pendingStorage(),
			newKey: () => crypto.randomUUID(),
			files: browserFileSaver(root.ownerDocument),
		}),
	});
}
