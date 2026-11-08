import { h } from "preact";
import { mountApp } from "../app/mount.tsx";
import type { PaneName } from "../app/panes.tsx";
import {
	allSchools,
	defaultTabOf,
	parseRoute,
	type Route,
} from "../app/route.ts";
import type { Disclosure } from "../data/disclosure.ts";
import type { DownloadFile } from "../data/ledger.ts";
import type { Reader } from "../data/reader.ts";
import type { Clock, School } from "../data/types.ts";
import { createHttpAdapters } from "./adapters.ts";
import { isDemoSchool } from "./demo.ts";
import { DemoBanner } from "./demo-banner.tsx";
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

/** The pane a route opens, as the shell picks it (`shell.tsx`): the member portal for Members with `portal=`, none for
 * All schools. */
const paneOf = ({ tab, query }: Route): PaneName | null => {
	if (tab === allSchools) return null;
	return tab === "members" && query.has("portal") ? "portal" : tab;
};

/** Starts downloading what the route's first paint waits for, so that it arrives with the reads rather than after
 * them: the shell's menus and settings, and the route's pane. Each module is fetched once; the app's own loads take the
 * same ones. */
export function warmUp(route: Route): void {
	const pane = paneOf(route);
	void import("../app/menus.tsx");
	void import("../app/settings.tsx");
	if (pane)
		void import("../app/panes.tsx").then(({ loadPane }) => loadPane(pane));
}

/** The school a hash names before the schools are read, or null when it names none. The app falls back to the first
 * school when the named one is not listed, so this is a guess that the read of the schools settles. */
function namedSchool(hash: string): string | null {
	const [path = ""] = hash.replace(/^#\/?/, "").split("?", 1);
	const [school = ""] = path.split("/");
	return school && school !== allSchools ? school : null;
}

/**
 * The first paint waits on the schools, the disclosure of the route's school, the route's pane module and then the
 * pane's data. This starts them together rather than one after another: the schools; when `hash` names a school, its
 * disclosure, which the Reader it answers hands to the shell's first ask for that school; and `warm` for the route,
 * at once for the school the hash names and again for the route the schools settle. The Reader's first `schools()`
 * is the read begun here.
 */
export function startFirstLoad(
	reader: Reader,
	hash: string,
	warm: (route: Route) => void = warmUp,
): { reader: Reader; schools: Promise<School[]> } {
	const schools = reader.schools();
	let firstSchools: Promise<School[]> | undefined = schools;
	let firstDisclosure: { school: string; answer: Promise<Disclosure> } | null =
		null;
	const school = namedSchool(hash);
	if (school) {
		const answer = reader.disclosure(school);
		// Never asked for when the schools do not list the school: its failure is then nobody's.
		answer.catch(() => undefined);
		firstDisclosure = { school, answer };
		warm(
			parseRoute(hash, [school], () =>
				defaultTabOf({ demo: isDemoSchool(school) }),
			),
		);
	}
	schools.then(
		(listed) =>
			warm(
				parseRoute(
					hash,
					listed.map(({ id }) => id),
					(id) => defaultTabOf(listed.find((candidate) => candidate.id === id)),
				),
			),
		// The app shows the failure: Sign in or Try again.
		() => undefined,
	);
	return {
		schools,
		reader: {
			...reader,
			schools: () => {
				const answer = firstSchools ?? reader.schools();
				firstSchools = undefined;
				return answer;
			},
			disclosure: (asked) => {
				const early = firstDisclosure;
				firstDisclosure = null;
				return early?.school === asked
					? early.answer
					: reader.disclosure(asked);
			},
		},
	};
}

/**
 * The HTTP build (`VITE_LEDGER_SOURCE=http`, `VITE_API_BASE`, `VITE_LEDGER_WORKER_BASE`): buzz-school's routes on
 * `apiBase`, the ledger Worker's reads (S8-contract section 11) on `workerBase`, `/v1` on the UI's own origin by
 * default, with the ledger token as their bearer. Gate H allows this file alone the browser's persistent storage and
 * one system clock read: the pending store lives in `localStorage`, and the clock is the instant of the mount as the
 * wall time of the first school's time zone (the browser's when there is no school). The schools read for that zone
 * is the one the app then shows. No PIN dialog is wired for the writes that do not collect one: once a books pane's
 * PIN lock has opened the session (`unlockBooks`) they go through; before, such a write rejects `pin_required`.
 *
 * Signed out (the ledger token answers 401) or administering no school, the visitor sees the Worker's demo schools
 * (S8-contract section 11 "Demo schools") under a large alert, rather than an empty page; where the Worker serves none
 * (production), the app's own sign-in prompt or empty list.
 *
 * The reads and modules of the first paint start together (`startFirstLoad`).
 */
export function mountHttpApp(
	root: HTMLElement,
	options: {
		apiBase: string;
		workerBase: string;
		webBase: string;
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
	const first = startFirstLoad(reader, window.location.hash);
	const signInUrl = `${options.webBase}/signin`;
	first.schools
		.then(
			(schools) => schools[0]?.timeZone,
			// A failure mounts the app all the same: it offers Sign in or Try again.
			() => undefined,
		)
		.then((timeZone) => {
			const session = reader.session();
			mountApp(root, {
				reader: first.reader,
				writer,
				clock: clockAt(
					mountedAt,
					timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
				),
				// The ledger token is minted from B4 Uni's session cookie: a signed-out visitor signs in on the web app.
				signInUrl,
				...(session !== "signed_in" && timeZone !== undefined
					? {
							banner: h(DemoBanner, {
								reason: session,
								signInUrl,
								reload: () => window.location.reload(),
							}),
						}
					: {}),
			});
		});
}
