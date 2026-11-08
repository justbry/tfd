import { flushSync } from "svelte";
import { createFixtureReader } from "$contract/fixtures/reader.ts";
import { createFixtureWriter } from "$contract/fixtures/writer.ts";
import { type MountedApp, mountApp } from "../../src/app/mount.ts";
import { appLayer } from "../../src/effect/app-layer.ts";
import { manualClock } from "../../src/effect/clock.ts";
import type { ConfigApi } from "../../src/effect/config-client.ts";
import {
	createFixtureConfig,
	type FixtureConfig,
} from "../../src/effect/config-fixture.ts";
import { calendar } from "../helpers.ts";

export const macrotask = (): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, 0));

/** Waits until the rendered route has equalled the hash for five turns in a row. */
export async function settle(root: HTMLElement): Promise<void> {
	let steady = 0;
	for (let turn = 0; turn < 800 && steady < 5; turn += 1) {
		flushSync();
		steady = root.dataset.route === window.location.hash ? steady + 1 : 0;
		await macrotask();
	}
}

export type Opened = {
	app: MountedApp;
	root: HTMLElement;
	/** The fixture Writer, which records every call and holds them in `hold` mode until `release()`. */
	writer: ReturnType<typeof createFixtureWriter>;
	config: FixtureConfig;
	clock: ReturnType<typeof manualClock>;
};

/** Mounts the app at `hash` on the fixture Reader, the fixture Writer (instant or held), the fixture config store (the
 * person owns `vol`, `nw` and `map`, is an admin on `b4u`: the fixture schools' own roles) and a clock moved by hand. */
export async function openPane(
	hash: string,
	options: {
		writer?: "instant" | "hold";
		config?: ConfigApi;
		reader?: (
			fixture: ReturnType<typeof createFixtureReader>,
		) => ReturnType<typeof createFixtureReader>;
		waitForRoute?: boolean;
	} = {},
): Promise<Opened> {
	document.body.innerHTML = '<div id="app"></div>';
	document.documentElement.className = "";
	window.history.replaceState(null, "", `/${hash}`);
	const root = document.getElementById("app") as HTMLElement;
	const clock = manualClock();
	const fixtureReader = createFixtureReader({ clock: calendar });
	const reader = options.reader ? options.reader(fixtureReader) : fixtureReader;
	const writer = createFixtureWriter({ mode: options.writer ?? "instant" });
	const config = createFixtureConfig({
		grant: async (school) => {
			const found = (await fixtureReader.schools()).find(
				({ id }) => id === school,
			);
			return found
				? { role: found.role, finance: found.role === "owner" }
				: null;
		},
	});
	const app = mountApp(root, {
		layer: appLayer({
			reader,
			writer,
			config: options.config ?? config,
			clockLayer: clock.layer,
		}),
		calendar,
	});
	if (options.waitForRoute !== false) {
		for (
			let turn = 0;
			turn < 800 && root.dataset.route === undefined;
			turn += 1
		) {
			flushSync();
			await macrotask();
		}
		if (root.dataset.route === undefined)
			throw new Error("timed out waiting for the route to render");
	}
	return { app, root, writer, config, clock };
}

/** Waits for `check` to hold, flushing Svelte between turns. */
export async function until(
	check: () => boolean,
	what: string,
	turns = 400,
): Promise<void> {
	for (let turn = 0; turn < turns; turn += 1) {
		flushSync();
		if (check()) return;
		await macrotask();
	}
	throw new Error(`timed out waiting for ${what}`);
}
