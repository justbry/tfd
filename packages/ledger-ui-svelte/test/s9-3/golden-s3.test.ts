import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { flushSync } from "svelte";
import type { MountedApp } from "../../src/app/mount.ts";
import { macrotask, openPane, settle } from "./harness.ts";

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
type Expectation = {
	text?: Record<string, string | { text: string; moves: true }>;
	contains?: Record<string, string[]>;
	count?: Record<string, number>;
	value?: Record<string, string[]>;
	hash?: string;
	writes?: Array<{ method: string; args: unknown[] }>;
	absent?: string[];
};
type Step =
	| { click: string; expect?: Expectation }
	| { fill: string; value: string; expect?: Expectation }
	| { key: string; target: string; expect?: Expectation }
	| { release: true; expect?: Expectation };
type Entry = {
	id: string;
	route: string;
	writer?: "instant" | "hold";
	covers?: Record<string, string>;
	steps?: Step[];
	expect: Expectation;
};
type GoldenFile = {
	hooks: string[];
	matrix: Record<string, string[]>;
	entries: Entry[];
};

const golden = JSON.parse(
	readFileSync(join(import.meta.dir, "../../../ledger-ui/test/golden/S3.json"), "utf8"),
) as GoldenFile;
const globallyAbsent = ["NaN", "undefined", "null", "[object Object]", "Infinity"];

const mapSelector = (selector: string): string =>
	selector
		.replace(/\.on\b/g, '[aria-pressed="true"]')
		.replace(/\.chg\b/g, "[data-changed]")
		.replace(/\.next\b/g, "[data-next]")
		.replace(/\.bad\b/g, "[data-bad]");
const normalize = (value: string | null | undefined): string => (value ?? "").replace(/\s+/g, " ").trim();
const found = async (selector: string): Promise<HTMLElement> => {
	const mapped = mapSelector(selector);
	for (let turn = 0; turn < 200; turn += 1) {
		flushSync();
		const element = document.querySelector<HTMLElement>(mapped);
		if (element) return element;
		await macrotask();
	}
	throw new Error(`no element matches ${selector}`);
};

const check = (root: HTMLElement, expectation: Expectation, calls: ReadonlyArray<unknown>): void => {
	for (const [selector, expected] of Object.entries(expectation.text ?? {})) {
		const element = document.querySelector(mapSelector(selector));
		expect({ selector, text: normalize(element?.textContent) }).toEqual({
			selector,
			text: typeof expected === "string" ? expected : expected.text,
		});
	}
	for (const [selector, parts] of Object.entries(expectation.contains ?? {})) {
		const matches = [...document.querySelectorAll(mapSelector(selector))];
		expect({ selector, found: matches.length > 0 }).toEqual({ selector, found: true });
		const text = normalize(matches.map((match) => match.textContent).join(" "));
		for (const part of parts)
			expect({ selector, contains: part, ok: text.includes(part) }).toEqual({ selector, contains: part, ok: true });
	}
	for (const [selector, count] of Object.entries(expectation.count ?? {}))
		expect({ selector, count: document.querySelectorAll(mapSelector(selector)).length }).toEqual({ selector, count });
	for (const [selector, parts] of Object.entries(expectation.value ?? {})) {
		const control = document.querySelector<HTMLInputElement>(mapSelector(selector));
		for (const part of parts)
			expect({ selector, value: part, ok: control?.value.includes(part) }).toEqual({ selector, value: part, ok: true });
	}
	if (expectation.hash !== undefined) expect(window.location.hash).toContain(expectation.hash);
	if (expectation.writes) expect(calls).toEqual(expectation.writes);
	const pageText = normalize(root.textContent);
	for (const word of [...globallyAbsent, ...(expectation.absent ?? [])])
		expect({ absent: word, present: pageText.includes(word) }).toEqual({ absent: word, present: false });
};

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
			(partial, [axis, values]) => partial.flatMap((combination) => values.map((value) => ({ ...combination, [axis]: value }))),
			[{}],
		);
		const missing = combinations.filter(
			(combination) =>
				!golden.entries.some((entry) => Object.entries(combination).every(([axis, value]) => entry.covers?.[axis] === value)),
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
			.map((file) => readFileSync(join(import.meta.dir, "../../src/app", file), "utf8"))
			.join("\n");
		const missing = golden.hooks.filter((hook) => !source.includes(`"${hook}"`));
		expect(missing).toEqual([]);
	});
	for (const entry of golden.entries)
		test(entry.id, async () => {
			const { app, root, writer } = await openPane(entry.route, { writer: entry.writer ?? "instant" });
			mounted = app;
			await settle(root);
			for (const step of entry.steps ?? []) {
				if ("click" in step) (await found(step.click)).click();
				else if ("fill" in step) {
					const target = (await found(step.fill)) as HTMLInputElement;
					target.value = step.value;
					target.dispatchEvent(new Event("input", { bubbles: true }));
				} else if ("key" in step)
					(await found(step.target)).dispatchEvent(new KeyboardEvent("keydown", { key: step.key, bubbles: true }));
				else writer.release();
				await settle(root);
				if (step.expect) check(root, step.expect, writer.calls);
			}
			check(root, entry.expect, writer.calls);
		});
});
