import { allSchools, type Route } from "$contract/app/route.ts";
import type { DownloadFile } from "$contract/data/ledger.ts";
import type { Clock as CalendarClock } from "$contract/data/types.ts";
import { memoryStorage, type StorageLike } from "$contract/http/pending.ts";
import { localWallTime } from "$contract/http/school-routes.ts";
import type { FileSaver } from "$contract/http/writer.ts";
import { type MountedApp, mountApp } from "./app/mount.ts";
import { chunks } from "./app/Shell.svelte";
import { createHttpServices, httpLayerOf } from "./effect/http-layer.ts";
import { startFirstLoad } from "./first-load.ts";

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

/** The HTTP build's calendar (protocol §3: the entry supplies it, the UI never reads the system time): `seconds` as the
 * wall time of `timeZone`. */
export function clockAt(seconds: number, timeZone: string): CalendarClock {
	const now = localWallTime(seconds, timeZone);
	return { today: now.slice(0, 10), now };
}

/** Starts downloading what the route's first paint waits for, so that it arrives with the reads rather than after
 * them: the route's pane. Each module is fetched once; the app's own loads take the same ones. */
export function warmUp(route: Route): void {
	void chunks[route.tab === allSchools ? "allSchools" : route.tab]();
}

/** B4 Uni cannot send a visitor back to the ledger after signing in, so "I have signed in" forgets the 401 kept from
 * before and loads the page again, which asks the token again. */
export function signedInHandler(
	tokens: { forgetSignedOut(): void },
	reload: () => void,
): () => void {
	return () => {
		tokens.forgetSignedOut();
		reload();
	};
}

/** The HTTP build's entry. Gate H allows this file alone the browser's persistent storage and one system clock
 * read: the calendar is the instant of the mount as the wall time of the first school's time zone (the browser's when
 * there is no school). The schools read for that zone is the one the app then shows (`startFirstLoad`).
 *
 * Signed out (the ledger token answers 401) or administering no school, the visitor sees the Worker's demo schools
 * (S8-contract section 11 "Demo schools") under a large alert, rather than an empty page; where the Worker serves none
 * (production), the app's own message and Retry. */
export function mountHttpApp(
	root: HTMLElement,
	options: {
		apiBase: string;
		workerBase: string;
		webBase: string;
		/** What "I have signed in" does after forgetting the 401: the page loads again. */
		reload?: () => void;
	},
): Promise<MountedApp> {
	const mountedAt = Date.now() / millisecondsPerSecond;
	const browserFetch = (url: string, init: RequestInit) => fetch(url, init);
	const services = createHttpServices({
		fetch: browserFetch,
		apiBase: options.apiBase,
		workerBase: options.workerBase,
		storage: pendingStorage(),
		newKey: () => crypto.randomUUID(),
		files: browserFileSaver(root.ownerDocument),
	});
	const first = startFirstLoad(services.reader, window.location.hash, warmUp);
	// The ledger token is minted from B4 Uni's session cookie: a signed-out visitor signs in on the web app.
	const signInUrl = `${options.webBase}/signin`;
	return first.schools
		.then(
			(schools) => schools[0]?.timeZone,
			// A failure mounts the app all the same: it shows the message with Retry.
			() => undefined,
		)
		.then((timeZone) => {
			return mountApp(root, {
				calendar: clockAt(
					mountedAt,
					timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
				),
				layer: httpLayerOf(services, { reader: first.reader }),
				banner: {
					reason: () => {
						const session = services.reader.session();
						return session === "signed_in" ? null : session;
					},
					signInUrl,
					onSignedIn: signedInHandler(
						services.tokens,
						options.reload ?? (() => window.location.reload()),
					),
					load: () => import("./app/demo-banner/DemoBanner.svelte"),
				},
			});
		});
}
