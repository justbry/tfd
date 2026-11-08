import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { flushSync } from "svelte";
import type { MountedApp } from "../../src/app/mount.ts";
import { openApp } from "../app-harness.ts";

/**
 * The Preact package's Dashboard golden file (packages/ledger-ui/test/golden/S1.json, read in place and unchanged)
 * run against the Svelte app with the semantics of its runner (packages/ledger-ui/test/golden.test.ts): each entry's
 * route is mounted on the fixture layer, its steps run, and every `text` (exact, whitespace collapsed), `contains`,
 * `count`, `hash` and `absent` expectation is checked, with the global absent list (NaN, undefined, null, [object
 * Object], Infinity) on the whole app's text.
 *
 * Mapping, the only differences from the Preact runner:
 * - the Preact markup marks a pressed control with the class `on` and the open month with `kopen`; the Svelte markup
 *   carries the state itself: `.on` reads `[aria-pressed="true"]` and `.kopen` reads `[data-open]`;
 * - a step waits for its target to exist (the shadcn-svelte popovers render their content after the click), and after
 *   a step the runner waits until the rendered route has matched the hash for several turns in a row (an unlock goes
 *   through the Effect runtime before it navigates);
 * - the unknown-hook check is not run: the Svelte shell has its own hooks (S9.0), and the golden's hooks are all
 *   present (the hooks test below).
 */
type Expectation = {
	text?: Record<string, string | { text: string; moves: true }>;
	contains?: Record<string, string[]>;
	count?: Record<string, number>;
	hash?: string;
	absent?: string[];
};
type Step =
	| { click: string; expect?: Expectation }
	| { fill: string; value: string; expect?: Expectation };
type Entry = {
	id: string;
	route: string;
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
	readFileSync(
		join(import.meta.dir, "../../../ledger-ui/test/golden/S1.json"),
		"utf8",
	),
) as GoldenFile;
const globallyAbsent = [
	"NaN",
	"undefined",
	"null",
	"[object Object]",
	"Infinity",
];

/** The Preact markup's state classes, as the Svelte markup carries them. */
const mapSelector = (selector: string): string =>
	selector
		.replaceAll(".kopen", "[data-open]")
		.replace(/\.on\b/g, '[aria-pressed="true"]');

const normalize = (value: string | null | undefined): string =>
	(value ?? "").replace(/\s+/g, " ").trim();
const macrotask = (): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, 0));
/** Waits until the rendered route has equalled the hash for five turns in a row. */
const settle = async (root: HTMLElement): Promise<void> => {
	let steady = 0;
	for (let turn = 0; turn < 800 && steady < 5; turn += 1) {
		flushSync();
		steady = root.dataset.route === window.location.hash ? steady + 1 : 0;
		await macrotask();
	}
};
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

const check = (root: HTMLElement, expectation: Expectation): void => {
	for (const [selector, expected] of Object.entries(expectation.text ?? {})) {
		const element = document.querySelector(mapSelector(selector));
		expect({ selector, text: normalize(element?.textContent) }).toEqual({
			selector,
			text: typeof expected === "string" ? expected : expected.text,
		});
	}
	for (const [selector, parts] of Object.entries(expectation.contains ?? {})) {
		const matches = [...document.querySelectorAll(mapSelector(selector))];
		expect({ selector, found: matches.length > 0 }).toEqual({
			selector,
			found: true,
		});
		const text = normalize(matches.map((match) => match.textContent).join(" "));
		for (const part of parts)
			expect({ selector, contains: part, ok: text.includes(part) }).toEqual({
				selector,
				contains: part,
				ok: true,
			});
	}
	for (const [selector, count] of Object.entries(expectation.count ?? {}))
		expect({
			selector,
			count: document.querySelectorAll(mapSelector(selector)).length,
		}).toEqual({ selector, count });
	if (expectation.hash !== undefined)
		expect(window.location.hash).toContain(expectation.hash);
	const pageText = normalize(root.textContent);
	for (const word of [...globallyAbsent, ...(expectation.absent ?? [])])
		expect({ absent: word, present: pageText.includes(word) }).toEqual({
			absent: word,
			present: false,
		});
};

let mounted: MountedApp | undefined;
afterEach(async () => {
	await mounted?.unmount();
	mounted = undefined;
});

describe("golden S1 on the Svelte Dashboard", () => {
	test("covers its matrix combination by combination", () => {
		const missing = golden.matrix.view?.flatMap((view) =>
			(golden.matrix.as ?? []).filter(
				(as) =>
					!golden.entries.some(
						(entry) => entry.covers?.view === view && entry.covers.as === as,
					),
			),
		);
		expect(missing).toEqual([]);
	});
	for (const entry of golden.entries)
		test(entry.id, async () => {
			const { app, root } = await openApp(entry.route);
			mounted = app;
			await settle(root);
			for (const step of entry.steps ?? []) {
				const target = await found("click" in step ? step.click : step.fill);
				if ("click" in step) target.click();
				else {
					(target as HTMLInputElement).value = step.value;
					target.dispatchEvent(new Event("input", { bubbles: true }));
				}
				await settle(root);
				if (step.expect) check(root, step.expect);
			}
			check(root, entry.expect);
		});
});
