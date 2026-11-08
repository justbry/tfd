import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { flushSync } from "svelte";
import type { Reader } from "$contract/data/reader.ts";
import { createFixtureReader } from "$contract/fixtures/reader.ts";
import { createFixtureWriter } from "$contract/fixtures/writer.ts";
import { type MountedApp, mountApp } from "../../src/app/mount.ts";
import { appLayer } from "../../src/effect/app-layer.ts";
import { manualClock } from "../../src/effect/clock.ts";
import { until } from "../app-harness.ts";
import { calendar, noConfig } from "../helpers.ts";

/**
 * The Ledger and Reports entries of the Preact package's golden file S5 (packages/ledger-ui/test/golden/S5.json, read in
 * place and unchanged), run against the Svelte panes with the semantics of the Preact runner
 * (packages/ledger-ui/test/golden.test.ts), as test/s9-2/golden-runner.ts does for S2 and S4: each entry's route is mounted
 * on the fixture Reader and a fixture Writer in the entry's mode, its steps run (click, fill, key, release), and every
 * `text` (exact, whitespace collapsed), `contains`, `count`, `value`, `hash`, `writes` and `absent` expectation is checked,
 * with the global absent list on the whole app's text. A text marked `moves` is checked again through a Reader that
 * multiplies the file's `moves.fields` (protocol §7): it must exist, pass the absent list and differ.
 *
 * Mapping, the only differences from the Preact runner (the class-to-attribute mapping of `classMap`):
 * - the Preact markup marks state with classes (`on` a pressed chip, `neg` a negative amount, `kwait` a period inside its
 *   delay, `kon` the period shown); the Svelte markup carries the state itself (`.on` reads `[aria-pressed="true"]`,
 *   `.neg` `[data-negative]`, `.kwait` `[data-waiting]`, `.kon` `[data-current]`, `.kcutv` a suppressed figure
 *   `[data-figure="suppressed"]`, `.kapprox` a rounded one `[data-figure="approx"]`); a class inside quotes is left as it is;
 * - a step waits for its target to exist (the panes are loaded on demand), and after a step the runner waits until the
 *   rendered route has matched the hash and the page has stopped changing (a write goes through the Effect runtime before
 *   its effect shows);
 * - the entries run are those of the Ledger and Reports (`ledger-` and `reports-`); the Promos entries are S9.3's. The
 *   matrix is covered over the tabs run, and the hooks of the file are those of the two tabs and the donors card;
 * - `reports-gifts-to-promos` ends on the Promos tab, whose rows are S9.3's: its click and the hash it ends on are checked
 *   here, and the four promo rows by the Promos golden test (test/s9-3/golden-s5-promos.test.ts);
 * - the unknown-hook check is not run: the Svelte shell has its own hooks (S9.0), and the golden's hooks are all present
 *   (the hooks test).
 */
type TextExpectation = string | { text: string; moves: true };
type Expectation = {
	text?: Record<string, TextExpectation>;
	contains?: Record<string, string[]>;
	count?: Record<string, number>;
	hash?: string;
	writes?: Array<{ method: string; args: unknown[] }>;
	absent?: string[];
	value?: Record<string, string[]>;
};
type Step =
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
	slice: string;
	hooks: string[];
	matrix?: Record<string, string[]>;
	moves?: { fields: string[] };
	entries: Entry[];
};

export const readGolden = (name: string): GoldenFile =>
	JSON.parse(
		readFileSync(
			join(import.meta.dir, "../../../ledger-ui/test/golden", name),
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
export const classMap: Record<string, string> = {
	on: '[aria-pressed="true"]',
	neg: "[data-negative]",
	kwait: "[data-waiting]",
	kon: "[data-current]",
	kcutv: '[data-figure="suppressed"]',
	kapprox: '[data-figure="approx"]',
};
const quoted = /"[^"]*"|'[^']*'/g;
/** The Preact markup's state classes as the Svelte markup carries them; text inside quotes is left alone. */
export const mapSelector = (selector: string): string => mapQuoted(selector);
const mapQuoted = (selector: string): string => {
	const parts: string[] = [];
	let last = 0;
	for (const match of selector.matchAll(quoted)) {
		parts.push(mapClasses(selector.slice(last, match.index)), match[0]);
		last = (match.index ?? 0) + match[0].length;
	}
	parts.push(mapClasses(selector.slice(last)));
	return parts.join("");
};
const mapClasses = (text: string): string =>
	text.replace(
		/\.([A-Za-z][\w-]*)/g,
		(whole, name: string) => classMap[name] ?? whole,
	);

const normalize = (value: string | null | undefined): string =>
	(value ?? "").replace(/\s+/g, " ").trim();
const goldenText = (expected: TextExpectation): string =>
	typeof expected === "string" ? expected : expected.text;
const moves = (expected: TextExpectation): boolean =>
	typeof expected !== "string" && expected.moves === true;
const expectationsOf = (entry: Entry): Expectation[] => [
	...(entry.steps ?? []).flatMap((step) => (step.expect ? [step.expect] : [])),
	entry.expect,
];
const hasMovingText = (entry: Entry): boolean =>
	expectationsOf(entry).some((expectation) =>
		Object.values(expectation.text ?? {}).some(moves),
	);
const macrotask = (): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, 0));
/** Waits until the rendered route has equalled the hash and the page has stopped changing, for several turns in a row. */
const settle = async (root: HTMLElement): Promise<void> => {
	let steady = 0;
	let before = "";
	for (let turn = 0; turn < 1200 && steady < 8; turn += 1) {
		flushSync();
		const now =
			root.dataset.route === window.location.hash ? root.innerHTML : "";
		steady = now !== "" && now === before ? steady + 1 : 0;
		before = now;
		await macrotask();
	}
};
const found = async (selector: string): Promise<HTMLElement> => {
	const mapped = mapSelector(selector);
	for (let turn = 0; turn < 300; turn += 1) {
		flushSync();
		const element = document.querySelector<HTMLElement>(mapped);
		if (element) return element;
		await macrotask();
	}
	throw new Error(`no element matches ${selector}`);
};
const required = (selector: string): Element => {
	const element = document.querySelector(mapSelector(selector));
	if (!element) throw new Error(`no element matches ${selector}`);
	return element;
};

const movesFactor =
	2 + (Number.parseInt((process.env.LEDGER_HEAD ?? "00").slice(0, 2), 16) % 8);
const nameMark = "·";
type FieldStep = { property: string } | { each: true };
const parseField = (field: string): { method: string; steps: FieldStep[] } => {
	const [first = "", ...rest] = field.split(".");
	const listStep = (segment: string): FieldStep[] =>
		segment.endsWith("[]") ? [{ each: true }] : [];
	return {
		method: first.replace("[]", ""),
		steps: [
			...listStep(first),
			...rest.flatMap((segment) => [
				{ property: segment.replace("[]", "") },
				...listStep(segment),
			]),
		],
	};
};
const moveValue = (
	value: unknown,
	steps: FieldStep[],
	field: string,
): unknown => {
	if (value === null || value === undefined) return value;
	const [step, ...rest] = steps;
	if (!step) {
		if (typeof value === "number") return value * movesFactor;
		if (typeof value === "string") return `${value}${nameMark}`;
		throw new Error(`${field} is not an amount, a count or a name`);
	}
	if ("each" in step) {
		if (!Array.isArray(value)) throw new Error(`${field}: not a list`);
		return value.map((item) => moveValue(item, rest, field));
	}
	if (typeof value !== "object")
		throw new Error(`${field}: ${step.property} is not on an object`);
	const record = value as Record<string, unknown>;
	return {
		...record,
		[step.property]: moveValue(record[step.property], rest, field),
	};
};
const movingReader = (reader: Reader, fields: string[]): Reader => {
	const parsed = fields.map((field) => ({ field, ...parseField(field) }));
	const wrapped: Record<string, unknown> = {};
	for (const [name, member] of Object.entries(reader)) {
		const own = parsed.filter((path) => path.method === name);
		wrapped[name] =
			typeof member === "function" && own.length > 0
				? async (...args: unknown[]) => {
						let value: unknown = await member.apply(reader, args);
						for (const path of own)
							value = moveValue(value, path.steps, path.field);
						return value;
					}
				: member;
	}
	return wrapped as unknown as Reader;
};

const checkAbsent = (root: HTMLElement, expectation: Expectation): void => {
	const pageText = normalize(root.textContent);
	for (const word of [...globallyAbsent, ...(expectation.absent ?? [])])
		expect({ absent: word, present: pageText.includes(word) }).toEqual({
			absent: word,
			present: false,
		});
};
const check = (
	root: HTMLElement,
	expectation: Expectation,
	writerCalls: ReadonlyArray<unknown>,
): void => {
	for (const [selector, expected] of Object.entries(expectation.text ?? {}))
		expect({
			selector,
			text: normalize(required(selector).textContent),
		}).toEqual({
			selector,
			text: goldenText(expected),
		});
	for (const [selector, parts] of Object.entries(expectation.contains ?? {})) {
		const matches = [...document.querySelectorAll(mapSelector(selector))];
		expect({ selector, found: matches.length > 0 }).toEqual({
			selector,
			found: true,
		});
		const text = normalize(
			matches.map((element) => element.textContent).join(" "),
		);
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
		}).toEqual({
			selector,
			count,
		});
	for (const [selector, parts] of Object.entries(expectation.value ?? {})) {
		const control = required(selector) as HTMLInputElement;
		for (const part of parts)
			expect({
				selector,
				value: part,
				ok: control.value.includes(part),
			}).toEqual({
				selector,
				value: part,
				ok: true,
			});
	}
	if (expectation.hash !== undefined)
		expect(window.location.hash).toContain(expectation.hash);
	if (expectation.writes) expect(writerCalls).toEqual(expectation.writes);
	checkAbsent(root, expectation);
};
const checkMoved = (root: HTMLElement, expectation: Expectation): void => {
	for (const [selector, expected] of Object.entries(expectation.text ?? {})) {
		if (!moves(expected)) continue;
		const golden = goldenText(expected);
		const text = normalize(required(selector).textContent);
		expect({ selector, golden, moved: text !== golden }).toEqual({
			selector,
			golden,
			moved: true,
		});
	}
	checkAbsent(root, expectation);
};

let mounted: MountedApp | undefined;
afterEach(async () => {
	await mounted?.unmount();
	mounted = undefined;
	document.body.innerHTML = "";
});

const runEntry = async (
	entry: Entry,
	reader: Reader,
	verify: (
		root: HTMLElement,
		expectation: Expectation,
		calls: ReadonlyArray<unknown>,
	) => void,
): Promise<void> => {
	// A saved file's link leaves happy-dom on a blob address: every entry starts on the page's own.
	(
		window as unknown as { happyDOM?: { setURL(address: string): void } }
	).happyDOM?.setURL("https://ledger.test/");
	document.body.innerHTML = '<div id="app"></div>';
	document.documentElement.className = "";
	window.history.replaceState(null, "", `/${entry.route}`);
	const root = document.getElementById("app") as HTMLElement;
	const writer = createFixtureWriter({ mode: entry.writer ?? "instant" });
	mounted = mountApp(root, {
		layer: appLayer({
			reader,
			writer,
			config: noConfig,
			clockLayer: manualClock().layer,
		}),
		calendar,
	});
	await until(
		() => root.dataset.route !== undefined,
		"the route to render",
		1500,
	);
	await settle(root);
	for (const step of entry.steps ?? []) {
		if ("release" in step) writer.release();
		else if ("key" in step) {
			const target = await found(step.target);
			target.dispatchEvent(
				new KeyboardEvent("keydown", { key: step.key, bubbles: true }),
			);
		} else if ("fill" in step) {
			const input = (await found(step.fill)) as HTMLInputElement;
			input.value = step.value;
			input.dispatchEvent(new Event("input", { bubbles: true }));
		} else (await found(step.click)).click();
		await settle(root);
		if (step.expect) verify(root, step.expect, writer.calls);
	}
	verify(root, entry.expect, writer.calls);
};

/** The hooks of the file that belong to other tabs or to the shell, not to the Ledger, Reports and the donors card:
 * Promos' (S9.3) and the shared dialog and toast, which the shell and the panes of other slices draw. */
const otherHooks = (hook: string): boolean =>
	hook.startsWith("promo") || hook.startsWith("dialog") || hook === "toast";
const ownEntry = ({ id }: Entry): boolean =>
	id.startsWith("ledger-") || id.startsWith("reports-");
/** The Promos rows an entry ends on are the Promos tab's (S9.3): only the hash it ends on is checked here. */
const withoutPromoRows = (entry: Entry): Entry => {
	const { count, ...rest } = entry.expect;
	const kept = Object.fromEntries(
		Object.entries(count ?? {}).filter(
			([selector]) => !selector.includes("promo-"),
		),
	);
	return {
		...entry,
		expect: Object.keys(kept).length > 0 ? { ...rest, count: kept } : rest,
	};
};

/** Registers the tests of the Ledger and Reports entries of one golden file. `sources` are the directories whose markup
 * must carry the file's hooks. */
export function defineGolden(file: GoldenFile, sources: string[]): void {
	const entries = file.entries.filter(ownEntry);
	describe(`golden ${file.slice} (Ledger, Reports) on the Svelte panes`, () => {
		test("runs every Ledger and Reports entry of the file", () => {
			expect(entries.length).toBe(
				file.entries.filter(({ id }) => !id.startsWith("promos-")).length,
			);
			expect(entries.length).toBeGreaterThan(40);
		});
		test("covers its matrix over the tabs run combination by combination", () => {
			const axes = Object.entries(file.matrix ?? {}).map(
				([axis, values]): [string, string[]] => [
					axis,
					axis === "tab" ? values.filter((tab) => tab !== "promos") : values,
				],
			);
			const combinations = axes.reduce<Array<Record<string, string>>>(
				(partial, [axis, values]) =>
					partial.flatMap((combination) =>
						values.map((value) => ({ ...combination, [axis]: value })),
					),
				[{}],
			);
			const missing = combinations.filter(
				(combination) =>
					!entries.some((entry) =>
						Object.entries(combination).every(
							([axis, value]) => entry.covers?.[axis] === value,
						),
					),
			);
			expect(missing).toEqual([]);
		});
		test("every hook of the Ledger, Reports and donors card is in the markup", () => {
			const text = sources
				.flatMap((directory) =>
					readdirSync(join(import.meta.dir, "../../src/app", directory)).map(
						(name) =>
							readFileSync(
								join(import.meta.dir, "../../src/app", directory, name),
								"utf8",
							),
					),
				)
				.join("\n");
			const missing = file.hooks
				.filter((hook) => !otherHooks(hook))
				.filter(
					(hook) =>
						!text.includes(`"${hook}"`) &&
						!text.includes(`data-test="${hook}`) &&
						!text.includes(`'${hook}'`),
				);
			expect(missing).toEqual([]);
		});
		const movingEntries = entries.filter(hasMovingText);
		const fields = file.moves?.fields ?? [];
		for (const entry of entries)
			test(entry.id, () =>
				runEntry(
					withoutPromoRows(entry),
					createFixtureReader({ clock: calendar }),
					check,
				),
			);
		for (const entry of movingEntries)
			test(`${entry.id} (moves ×${movesFactor})`, () =>
				runEntry(
					entry,
					movingReader(createFixtureReader({ clock: calendar }), fields),
					checkMoved,
				));
	});
}
