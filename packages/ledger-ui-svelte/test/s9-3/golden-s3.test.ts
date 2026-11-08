import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MountedApp } from "../../src/app/mount.ts";
import { type GoldenFile, runEntry } from "./golden-runner.ts";

/**
 * The Preact package's Plans golden file (packages/ledger-ui/test/golden/S3.json, read in place and unchanged) run against
 * the Svelte Plans tab with the semantics of its runner (packages/ledger-ui/test/golden.test.ts): each entry's route is
 * mounted on the fixture layer (the fixture Writer in the entry's mode), its steps run (`click`, `fill`, `key`,
 * `release`), and every `text` (exact, whitespace collapsed), `contains`, `count`, `value`, `hash`, `writes` and `absent`
 * expectation is checked, with the global absent list on the whole app's text.
 *
 * Mapping, the only differences from the Preact runner (the Preact markup marks state with classes, the Svelte markup
 * carries the state itself, as the S9.1 golden does):
 * - `.on` (a pressed segment or chip) reads `[aria-pressed="true"]`;
 * - `.chg` (a plan the draft changes) reads `[data-changed]`;
 * - `.next` (the Get started step to do next) reads `[data-next]`;
 * - `.bad` (a gutter line with a problem) reads `[data-bad]`;
 * - a step waits for its target to exist (the sheets and dialogs render after the click), and after a step the runner waits
 *   until the rendered route has matched the hash for several turns in a row;
 * - the unknown-hook check is not run (the Svelte shell has its own hooks); the hooks test below proves every hook of this
 *   slice's golden file is in the Svelte source;
 * - the moving-data run is not repeated (S9.1's golden does not either): the figures come from the Reader.
 */

const golden = JSON.parse(
	readFileSync(
		join(import.meta.dir, "../../../ledger-ui/test/golden/S3.json"),
		"utf8",
	),
) as GoldenFile;

let mounted: MountedApp | undefined;
afterEach(async () => {
	await mounted?.unmount();
	mounted = undefined;
	document.body.innerHTML = "";
});

describe("golden S3 on the Svelte Plans tab", () => {
	test("covers its matrix combination by combination", () => {
		const axes = Object.entries(golden.matrix);
		const combinations = axes.reduce<Array<Record<string, string>>>(
			(partial, [axis, values]) =>
				partial.flatMap((combination) =>
					values.map((value) => ({ ...combination, [axis]: value })),
				),
			[{}],
		);
		const missing = combinations.filter(
			(combination) =>
				!golden.entries.some((entry) =>
					Object.entries(combination).every(
						([axis, value]) => entry.covers?.[axis] === value,
					),
				),
		);
		expect(missing).toEqual([]);
	});
	test("every hook of the golden file is in the Svelte source", () => {
		const source = [
			"plans/Plans.svelte",
			"plans/PlanTables.svelte",
			"plans/PlanPreview.svelte",
			"plans/PlanCode.svelte",
			"plans/PlanDrawer.svelte",
			"plans/PlanPublishDialog.svelte",
			"plans/PlanSetup.svelte",
			"plans/PlanStrip.svelte",
			"plans/Withheld.svelte",
			"toasts/Toaster.svelte",
			"Shell.svelte",
		]
			.map((file) =>
				readFileSync(join(import.meta.dir, "../../src/app", file), "utf8"),
			)
			.join("\n");
		const missing = golden.hooks.filter(
			(hook) => !source.includes(`"${hook}"`),
		);
		expect(missing).toEqual([]);
	});
	for (const entry of golden.entries)
		test(entry.id, async () => {
			await runEntry(entry, (app) => {
				mounted = app;
			});
		});
});
