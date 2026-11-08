import { Layer } from "effect";
import { flushSync } from "svelte";
import type { Reader } from "$contract/data/reader.ts";
import type { Writer } from "$contract/data/writer.ts";
import { createFixtureReader } from "$contract/fixtures/reader.ts";
import { createFixtureWriter } from "$contract/fixtures/writer.ts";
import { type MountedApp, mountApp } from "../../src/app/mount.ts";
import { appLayer } from "../../src/effect/app-layer.ts";
import { manualClock } from "../../src/effect/clock.ts";
import { memoryLog } from "../../src/effect/log.ts";
import type { Toast } from "../../src/effect/toast-model.ts";
import { until } from "../app-harness.ts";
import { calendar, noConfig } from "../helpers.ts";

export const fixtureReader = (): Reader =>
	createFixtureReader({ clock: calendar });
export const fixtureWriter = (mode: "instant" | "hold" = "instant") =>
	createFixtureWriter({ mode });

/** Mounts the app on a fresh page at `hash` over the given Reader and Writer (fixtures by default), with a log the
 * test can read; waits for the route to render unless `waitForRoute` is false. */
export async function openPane(
	hash: string,
	options: {
		reader?: Reader;
		writer?: Writer;
		waitForRoute?: boolean;
	} = {},
): Promise<{
	app: MountedApp;
	root: HTMLElement;
	log: ReturnType<typeof memoryLog>;
	toasts: () => readonly Toast[];
}> {
	(
		window as unknown as { happyDOM?: { setURL(address: string): void } }
	).happyDOM?.setURL("https://ledger.test/");
	document.body.innerHTML = '<div id="app"></div>';
	document.documentElement.className = "";
	window.history.replaceState(null, "", `/${hash}`);
	const root = document.getElementById("app") as HTMLElement;
	const log = memoryLog();
	const layer = Layer.mergeAll(
		appLayer({
			reader: options.reader ?? fixtureReader(),
			writer: options.writer ?? fixtureWriter(),
			config: noConfig,
			clockLayer: manualClock().layer,
		}),
		log.layer,
	);
	const app = mountApp(root, { layer, calendar });
	if (options.waitForRoute !== false)
		await until(
			() => root.dataset.route !== undefined,
			"the route to render",
			1500,
		);
	return { app, root, log, toasts: () => app.toasts.state.visible };
}

export const settle = async (turns = 12): Promise<void> => {
	for (let turn = 0; turn < turns; turn += 1) {
		flushSync();
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
};
export const text = (selector: string): string =>
	document.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim() ??
	"";
export const all = (selector: string): HTMLElement[] => [
	...document.querySelectorAll<HTMLElement>(selector),
];
export const click = async (selector: string): Promise<void> => {
	await until(
		() => document.querySelector(selector) !== null,
		`${selector} to exist`,
		800,
	);
	(document.querySelector(selector) as HTMLElement).click();
	await settle();
};
export const fill = async (selector: string, value: string): Promise<void> => {
	await until(
		() => document.querySelector(selector) !== null,
		`${selector} to exist`,
		800,
	);
	const input = document.querySelector(selector) as HTMLInputElement;
	input.value = value;
	input.dispatchEvent(new Event("input", { bubbles: true }));
	await settle();
};
export const waitFor = (
	check: () => boolean,
	what: string,
	turns = 800,
): Promise<void> => until(check, what, turns);
/** A Reader whose listed methods are replaced (the rest are the fixture's). */
export const readerWith = (
	replaced: Partial<
		Record<keyof Reader, (...args: never[]) => Promise<unknown>>
	>,
): Reader => ({ ...fixtureReader(), ...replaced }) as unknown as Reader;
/** A Writer whose listed methods are replaced (the rest are the fixture's, in `mode`). */
export const writerWith = (
	replaced: Partial<
		Record<keyof Writer, (...args: never[]) => Promise<unknown>>
	>,
	mode: "instant" | "hold" = "instant",
) =>
	({ ...fixtureWriter(mode), ...replaced }) as unknown as Writer &
		ReturnType<typeof fixtureWriter>;
