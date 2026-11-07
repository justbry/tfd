import { Layer } from "effect";
import { flushSync } from "svelte";
import type { Reader as ReaderContract } from "$contract/data/reader.ts";
import { type MountedApp, mountApp } from "../src/app/mount.ts";
import { manualClock } from "../src/effect/clock.ts";
import { fixtureLayer } from "../src/effect/layers.ts";
import { Reader } from "../src/effect/services.ts";
import { calendar } from "./helpers.ts";

/** Waits for `check` to hold, flushing Svelte between turns. */
export async function until(check: () => boolean, what: string): Promise<void> {
	for (let turn = 0; turn < 400; turn += 1) {
		flushSync();
		if (check()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error(`timed out waiting for ${what}`);
}

export const query = <Found extends Element = HTMLElement>(
	selector: string,
): Found | null => document.querySelector<Found>(selector);
export const queryAll = (selector: string): HTMLElement[] => [
	...document.querySelectorAll<HTMLElement>(selector),
];
export const textOf = (selector: string): string =>
	query(selector)?.textContent?.replace(/\s+/g, " ").trim() ?? "";

/** Mounts the app on a fresh page at `hash` over the fixture layer (or a Reader changed by `reader`), and waits for
 * the route to render. */
export async function openApp(
	hash: string,
	options: {
		reader?: (fixture: ReaderContract) => ReaderContract;
		waitForRoute?: boolean;
	} = {},
): Promise<{
	app: MountedApp;
	root: HTMLElement;
	clock: ReturnType<typeof manualClock>;
}> {
	document.body.innerHTML = '<div id="app"></div>';
	document.documentElement.className = "";
	window.history.replaceState(null, "", `/${hash}`);
	const root = document.getElementById("app") as HTMLElement;
	const clock = manualClock(calendar);
	const base = fixtureLayer({ calendar, clockLayer: clock.layer });
	const layer = options.reader
		? Layer.mergeAll(
				base,
				Layer.effect(
					Reader,
					Reader.useSync((fixture) => options.reader?.(fixture) ?? fixture),
				).pipe(Layer.provide(base)),
			)
		: base;
	const app = mountApp(root, { layer, calendar });
	if (options.waitForRoute !== false)
		await until(() => root.dataset.route !== undefined, "the route to render");
	return { app, root, clock };
}

export function click(selector: string): void {
	const element = query(selector);
	if (!element) throw new Error(`nothing matches ${selector}`);
	element.click();
	flushSync();
}
