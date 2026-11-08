import { Layer } from "effect";
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
import { memoryLog } from "../../src/effect/log.ts";
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

/** The fixture config store of the harness: the person holds each fixture school's own role (an owner has the finance
 * grant, an admin does not). A test that changes a call builds one, wraps it and hands it to `openPane`. */
export function fixtureConfigFor(): FixtureConfig {
	const reader = createFixtureReader({ clock: calendar });
	return createFixtureConfig({
		grant: async (school) => {
			const found = (await reader.schools()).find(({ id }) => id === school);
			return found
				? { role: found.role, finance: found.role === "owner" }
				: null;
		},
	});
}

export type Opened = {
	app: MountedApp;
	root: HTMLElement;
	/** The fixture Writer, which records every call and holds them in `hold` mode until `release()`. */
	writer: ReturnType<typeof createFixtureWriter>;
	/** The harness's own store (not the one a test handed in): `calls`, `peek`, `writeBehind` and `setStepUp`. */
	config: FixtureConfig;
	clock: ReturnType<typeof manualClock>;
	/** What the app wrote to its log (a read nobody waits for any more writes none). */
	log: ReturnType<typeof memoryLog>;
};

/** Mounts the app at `hash` on the fixture Reader, the fixture Writer (instant or held), the fixture config store (the
 * person owns `vol`, `nw` and `map`, is an admin on `b4u`: the fixture schools' own roles) and a clock moved by hand. */
export async function openPane(
	hash: string,
	options: {
		writer?: "instant" | "hold";
		config?: ConfigApi;
		/** The fixture Writer, changed (a call made to fail, say). */
		writerWrap?: (
			fixture: ReturnType<typeof createFixtureWriter>,
		) => ReturnType<typeof createFixtureWriter>;
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
	const fixtureWriter = createFixtureWriter({
		mode: options.writer ?? "instant",
	});
	const writer = options.writerWrap
		? options.writerWrap(fixtureWriter)
		: fixtureWriter;
	const log = memoryLog();
	const config = fixtureConfigFor();
	const app = mountApp(root, {
		layer: Layer.mergeAll(
			appLayer({
				reader,
				writer,
				config: options.config ?? config,
				clockLayer: clock.layer,
			}),
			log.layer,
		),
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
	return { app, root, writer: fixtureWriter, config, clock, log };
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
