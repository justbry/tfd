import { h } from "preact";
import { mountApp } from "../app/mount.tsx";
import type { DownloadFile } from "../data/ledger.ts";
import type { Reader } from "../data/reader.ts";
import type { Clock, School } from "../data/types.ts";
import type { Writer } from "../data/writer.ts";
import { createHttpAdapters } from "./adapters.ts";
import { DemoBanner, type DemoReason } from "./demo-banner.tsx";
import { memoryStorage, type StorageLike } from "./pending.ts";
import { localWallTime } from "./school-routes.ts";
import { timerScheduler } from "./transport.ts";
import { createFetchWorkerSource } from "./worker-source.ts";
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
 * The HTTP build (`VITE_LEDGER_SOURCE=http`, `VITE_API_BASE`, `VITE_LEDGER_WORKER_BASE`): buzz-school's routes on
 * `apiBase`, the ledger Worker's reads (S8-contract section 11) on `workerBase`, `/v1` on the UI's own origin by
 * default, with the ledger token as their bearer. Gate H allows this file alone the browser's persistent storage and
 * one system clock read: the pending store lives in `localStorage`, and the clock is the instant of the mount as the
 * wall time of the first school's time zone (the browser's when there is no school). The schools read for that zone
 * is the one the app then shows. No PIN dialog is wired for the writes that do not collect one: once a books pane's
 * PIN lock has opened the session (`unlockBooks`) they go through; before, such a write rejects `pin_required`.
 */
export function mountHttpApp(
	root: HTMLElement,
	options: {
		apiBase: string;
		workerBase: string;
		webBase: string;
		/** The demo schools (the fixtures) a visitor sees when they are signed out or administer no school. */
		demo?: () => { reader: Reader; writer: Writer; clock: Clock };
	},
): void {
	const mountedAt = Date.now() / millisecondsPerSecond;
	const browserFetch = (url: string, init: RequestInit) => fetch(url, init);
	const { reader, writer } = createHttpAdapters({
		fetch: browserFetch,
		apiBase: options.apiBase,
		scheduler: timerScheduler,
		storage: pendingStorage(),
		newKey: () => crypto.randomUUID(),
		worker: (tokens) =>
			createFetchWorkerSource({
				fetch: browserFetch,
				base: options.workerBase,
				tokens,
				scheduler: timerScheduler,
			}),
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
	const signInUrl = `${options.webBase}/signin`;
	const demo = options.demo;
	/** Signed out (the ledger token answers 401) or no school (404, an empty list): the demo schools under a large
	 * alert rather than an empty page. Null when the HTTP app mounts instead. */
	const showDemo = (reason: DemoReason): null | undefined => {
		if (!demo) return undefined;
		mountApp(root, {
			...demo(),
			banner: h(DemoBanner, {
				reason,
				signInUrl,
				reload: () => window.location.reload(),
			}),
		});
		return null;
	};
	firstSchools
		.then(
			(schools) =>
				schools.length === 0 ? showDemo("no_school") : schools[0]?.timeZone,
			(error: unknown) => {
				// Any other failure mounts the app, which offers Try again.
				const reason = demoReasonOf(error);
				return reason === null ? undefined : showDemo(reason);
			},
		)
		.then((timeZone) => {
			if (timeZone === null) return;
			mountApp(root, {
				reader: sharedReader,
				writer,
				clock: clockAt(
					mountedAt,
					timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
				),
				// The ledger token is minted from B4 Uni's session cookie: a signed-out visitor signs in on the web app.
				signInUrl,
			});
		});
}

/** Which demo a failed first schools read calls for: signed out, or none (another failure). No school is an empty
 * list, not a failure (`ledger-token.ts`). */
function demoReasonOf(error: unknown): DemoReason | null {
	const kind =
		typeof error === "object" && error !== null && "kind" in error
			? (error as { kind: unknown }).kind
			: null;
	return kind === "unauthenticated" ? "signed_out" : null;
}
