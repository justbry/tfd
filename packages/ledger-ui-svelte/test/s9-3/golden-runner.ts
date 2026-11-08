import { expect } from "bun:test";
import { flushSync } from "svelte";
import type { MountedApp } from "../../src/app/mount.ts";
import { macrotask, openPane, settle } from "./harness.ts";

/** The golden runner's steps and checks (packages/ledger-ui/test/golden.test.ts) against the Svelte DOM, shared by the
 * Plans (S3) and Promos (S5) golden tests. The mapping of the Preact markup's state classes is in each test's header. */
export type Expectation = {
	text?: Record<string, string | { text: string; moves: true }>;
	contains?: Record<string, string[]>;
	count?: Record<string, number>;
	value?: Record<string, string[]>;
	hash?: string;
	writes?: Array<{ method: string; args: unknown[] }>;
	absent?: string[];
};
export type Step =
	| { click: string; expect?: Expectation }
	| { fill: string; value: string; expect?: Expectation }
	| { key: string; target: string; expect?: Expectation }
	| { release: true; expect?: Expectation };
export type Entry = {
	id: string;
	route: string;
	writer?: "instant" | "hold";
	covers?: Record<string, string>;
	steps?: Step[];
	expect: Expectation;
};
export type GoldenFile = {
	hooks: string[];
	matrix: Record<string, string[]>;
	entries: Entry[];
};

export const globallyAbsent = [
	"NaN",
	"undefined",
	"null",
	"[object Object]",
	"Infinity",
];

export const mapSelector = (selector: string): string =>
	selector
		.replace(/\.on\b/g, '[aria-pressed="true"]')
		.replace(/\.chg\b/g, "[data-changed]")
		.replace(/\.next\b/g, "[data-next]")
		.replace(/\.bad\b/g, "[data-bad]");
export const normalize = (value: string | null | undefined): string =>
	(value ?? "").replace(/\s+/g, " ").trim();
export const found = async (selector: string): Promise<HTMLElement> => {
	const mapped = mapSelector(selector);
	for (let turn = 0; turn < 200; turn += 1) {
		flushSync();
		const element = document.querySelector<HTMLElement>(mapped);
		if (element) return element;
		await macrotask();
	}
	throw new Error(`no element matches ${selector}`);
};

export const check = (
	root: HTMLElement,
	expectation: Expectation,
	calls: ReadonlyArray<unknown>,
): void => {
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
	for (const [selector, parts] of Object.entries(expectation.value ?? {})) {
		const control = document.querySelector<HTMLInputElement>(
			mapSelector(selector),
		);
		for (const part of parts)
			expect({
				selector,
				value: part,
				ok: control?.value.includes(part),
			}).toEqual({ selector, value: part, ok: true });
	}
	if (expectation.hash !== undefined)
		expect(window.location.hash).toContain(expectation.hash);
	if (expectation.writes) expect(calls).toEqual(expectation.writes);
	const pageText = normalize(root.textContent);
	for (const word of [...globallyAbsent, ...(expectation.absent ?? [])])
		expect({ absent: word, present: pageText.includes(word) }).toEqual({
			absent: word,
			present: false,
		});
};

/** Mounts the entry's route, runs its steps and checks each step's expectation, then the entry's. `onMounted` hands over the app at once, so that a failing check still unmounts it. */
export async function runEntry(
	entry: Entry,
	onMounted: (app: MountedApp) => void,
): Promise<void> {
	const { app, root, writer } = await openPane(entry.route, {
		writer: entry.writer ?? "instant",
	});
	onMounted(app);
	await settle(root);
	for (const step of entry.steps ?? []) {
		if ("click" in step) (await found(step.click)).click();
		else if ("fill" in step) {
			const target = (await found(step.fill)) as HTMLInputElement;
			target.value = step.value;
			target.dispatchEvent(new Event("input", { bubbles: true }));
		} else if ("key" in step)
			(await found(step.target)).dispatchEvent(
				new KeyboardEvent("keydown", { key: step.key, bubbles: true }),
			);
		else writer.release();
		await settle(root);
		if (step.expect) check(root, step.expect, writer.calls);
	}
	check(root, entry.expect, writer.calls);
}
