import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { flushSync } from "svelte";
import type { Reader } from "$contract/data/reader.ts";
import { createFixtureReader } from "$contract/fixtures/reader.ts";
import { createFixtureWriter } from "$contract/fixtures/writer.ts";
import { type MountedApp, mountApp } from "../../src/app/mount.ts";
import { appLayer } from "../../src/effect/app-layer.ts";
import { manualClock } from "../../src/effect/clock.ts";
import type { ConfigApi } from "../../src/effect/config-client.ts";
import { memoryLog } from "../../src/effect/log.ts";
import { until } from "../app-harness.ts";
import { calendar } from "../helpers.ts";
import { fixtureConfigFor } from "../s9-3/harness.ts";

/**
 * The Preact package's golden files S6 (member portal) and S7 (Settings), read in place and unchanged
 * (packages/ledger-ui/test/golden/S6.json, S7.json), run against the Svelte panes with the semantics of the Preact runner
 * (packages/ledger-ui/test/golden.test.ts), as test/s9-4/golden-runner.ts does for S5: each entry's route is mounted on
 * the fixture Reader and a fixture Writer in the entry's mode, its steps run (click, fill, key, release), and every `text`
 * (exact, whitespace collapsed), `contains`, `count`, `value`, `hash`, `writes` and `absent` expectation is checked, with
 * the global absent list on the whole app's text. A text marked `moves` is checked again through a Reader that multiplies
 * the file's `moves.fields` (protocol §7): it must exist, pass the absent list and differ.
 *
 * Class-to-attribute map (the Preact markup marks state with classes; the Svelte markup carries the state itself):
 * - `.on` on a segmented button or chip reads `[aria-pressed="true"]`; on a portal tab (`role=tab`) it reads
 *   `[aria-selected="true"]`. A class inside quotes is left as it is.
 *
 * The intentional differences (the only ones), each from the owner's rule that the school's config is written through the
 * ledger Worker's verify then PUT (S9-plan D18, D22), not through the buzz-school Writer:
 * - `saveAccountingBasis` and `saveDisclosure` are not Writer calls here. A `writes` expectation that names them is checked
 *   as the config store's calls instead (`expectedWrites`): the Writer made no such call, and the store was asked to
 *   `verify` and `put` the `settings` or `disclosure` object (a `put` with the value the Writer call carried: the basis and
 *   the day, or the override). The PIN of a disclosure save opens the session (the fixture Writer's `unlockBooks`, which it
 *   records for neither mode), so it is not in `writer.calls` either.
 * - A "hold" writer cannot hold a call it never receives: for those entries `release` also lets the held config `put`
 *   through, so "pending" is the PUT on its way (the button busy, no toast) exactly as it was the Writer's call.
 * - The four disclosure entries that go through the mailed link (`disclosure-public-step-up`, `-step-up-confirm`,
 *   `-step-up-cancel`, `-step-up-pending`) are replaced (`mailedLinkEntries`): nothing sends the link yet (no Writer route
 *   in the HTTP build, no Worker route), so a change that opens Public cannot be saved; it says so, with the action off
 *   and its reason reachable, and writes nothing.
 * - A step waits for its target to exist (the panes are loaded on demand), and after a step the runner waits until the
 *   rendered route has matched the hash and the page has stopped changing (a write goes through the Effect runtime before
 *   its effect shows).
 * - The unknown-hook check is not run: the Svelte shell has its own hooks (S9.0). The golden's own hooks are all present
 *   in the markup (the hooks test).
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
const quoted = /"[^"]*"|'[^']*'/g;
/** `.on` of the portal's tabs is `aria-selected`; of every other pressed control, `aria-pressed`. */
const mapClasses = (text: string): string =>
	text
		.replace(/(\[data-test=portal-tab\])\.on\b/g, '$1[aria-selected="true"]')
		.replace(/\.on\b/g, '[aria-pressed="true"]');
export const mapSelector = (selector: string): string => {
	const parts: string[] = [];
	let last = 0;
	for (const match of selector.matchAll(quoted)) {
		parts.push(mapClasses(selector.slice(last, match.index)), match[0]);
		last = (match.index ?? 0) + match[0].length;
	}
	parts.push(mapClasses(selector.slice(last)));
	return parts.join("");
};

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

/** The calls the config store was asked for, in order, with its `get`s left out (a read is not a write). */
type ConfigCall = { method: "verify" | "put"; name: string; value: unknown };
type Run = {
	writerCalls: ReadonlyArray<{ method: string; args: unknown[] }>;
	configCalls: ReadonlyArray<ConfigCall>;
};

/** What an expectation's `writes` means here: the Writer calls that remain Writer calls, and the config calls that stand
 * for the ones that moved to the Worker (see the header). */
const expectedWrites = (
	writes: NonNullable<Expectation["writes"]>,
): { writer: Array<{ method: string; args: unknown[] }>; config: string[] } => {
	const writer: Array<{ method: string; args: unknown[] }> = [];
	const config: string[] = [];
	for (const write of writes) {
		if (write.method === "saveAccountingBasis") config.push("settings");
		else if (write.method === "saveDisclosure") config.push("disclosure");
		else writer.push(write);
	}
	return { writer, config };
};

const checkAbsent = (root: HTMLElement, expectation: Expectation): void => {
	const pageText = normalize(root.textContent);
	for (const word of [...globallyAbsent, ...(expectation.absent ?? [])])
		expect({ absent: word, present: pageText.includes(word) }).toEqual({
			absent: word,
			present: false,
		});
};
const check = (root: HTMLElement, expectation: Expectation, run: Run): void => {
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
	if (expectation.writes) {
		const expected = expectedWrites(expectation.writes);
		expect(run.writerCalls).toEqual(expected.writer);
		// No write the Writer used to make was made by the Writer, and the config store was asked to put exactly the
		// objects those writes stand for (a `writes: []` means the store was put nothing).
		expect(
			run.configCalls
				.filter(({ method }) => method === "put")
				.map(({ name }) => name),
		).toEqual(expected.config);
	}
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

/** The fixture config store with its calls recorded in order, and `put` held until `release()` when the entry holds. */
function recordingConfig(hold: boolean): {
	config: ConfigApi;
	calls: ConfigCall[];
	release: () => void;
} {
	const store = fixtureConfigFor();
	const calls: ConfigCall[] = [];
	let open: () => void = () => undefined;
	const gate = new Promise<void>((resolve) => {
		open = resolve;
	});
	const config: ConfigApi = {
		...store,
		verify: (school, name, value) => {
			calls.push({ method: "verify", name, value });
			return store.verify(school, name, value);
		},
		put: (school, name, value, verifiedHash, baseEtag) => {
			calls.push({ method: "put", name, value });
			const put = store.put(school, name, value, verifiedHash, baseEtag);
			return hold
				? Effect.flatMap(
						Effect.promise(() => gate),
						() => put,
					)
				: put;
		},
	};
	return { config, calls, release: open };
}

const runEntry = async (
	entry: Entry,
	reader: Reader,
	verify: (root: HTMLElement, expectation: Expectation, run: Run) => void,
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
	const recorded = recordingConfig(entry.writer === "hold");
	mounted = mountApp(root, {
		layer: Layer.mergeAll(
			appLayer({
				reader,
				writer,
				config: recorded.config,
				clockLayer: manualClock().layer,
			}),
			memoryLog().layer,
		),
		calendar,
	});
	await until(
		() => root.dataset.route !== undefined,
		"the route to render",
		1500,
	);
	await settle(root);
	const run = (): Run => ({
		writerCalls: writer.calls,
		configCalls: recorded.calls,
	});
	for (const step of entry.steps ?? []) {
		if ("release" in step) {
			writer.release();
			recorded.release();
		} else if ("key" in step) {
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
		if (step.expect) verify(root, step.expect, run());
	}
	verify(root, entry.expect, run());
};

/** The four disclosure entries whose step is the mailed link (see the header): the change that opens Public is valid, says
 * what it needs, and cannot be saved. */
const publicOpeningSteps: Step[] = [
	{ click: "[data-test=settings-button]" },
	{
		fill: "[data-test=override-field][data-field=rule-audience]",
		value: "public",
	},
	{ fill: "[data-test=override-field][data-field=every]", value: "quarter" },
	{ click: "[data-test=disclosure-save]" },
];
const publicOpeningExpect: Expectation = {
	text: {
		"[data-test=override-message]":
			"Valid. More open for Public: your PIN and a mailed-link confirmation (it publishes).",
		"[data-test=disclosure-cell][data-class=income][data-audience=public]":
			"categories · quarter · 12 months",
	},
	count: {
		"[data-test=disclosure-save][aria-disabled=true]": 1,
		"[data-test=disclosure-gap][data-kind=not_available]": 1,
		"[data-test=dialog]": 0,
	},
	contains: {
		"[data-test=disclosure-gap]": [
			"Not available yet",
			"Opening Public needs a mailed-link confirmation, and no route sends it yet.",
		],
	},
	absent: ["Disclosure saved"],
	writes: [],
};
const mailedLinkEntries: Record<string, Entry["steps"]> = {
	"disclosure-public-step-up": publicOpeningSteps,
	"disclosure-step-up-confirm": publicOpeningSteps,
	"disclosure-step-up-cancel": publicOpeningSteps,
	"disclosure-step-up-pending": publicOpeningSteps,
};
const adapted = (entry: Entry): Entry => {
	const steps = mailedLinkEntries[entry.id];
	return steps
		? { id: entry.id, route: entry.route, steps, expect: publicOpeningExpect }
		: entry;
};

/** Registers the tests of the entries `keep` selects from one golden file. `sources` are the directories under src/app
 * whose markup must carry the file's hooks, less the hooks `otherHooks` names (other slices' and the shell's). */
export function defineGolden(
	file: GoldenFile,
	options: {
		title: string;
		keep: (entry: Entry) => boolean;
		sources: string[];
		/** Files of src/app itself that carry some of the hooks. */
		files?: string[];
		otherHooks: (hook: string) => boolean;
		/** The matrix axes' values this selection covers. */
		matrix?: (axis: string, values: string[]) => string[];
		minimumEntries: number;
	},
): void {
	const entries = file.entries.filter(options.keep).map(adapted);
	describe(`golden ${file.slice} (${options.title}) on the Svelte panes`, () => {
		test("runs the entries of the file that belong to these tabs", () => {
			expect(entries.length).toBeGreaterThanOrEqual(options.minimumEntries);
		});
		test("covers its matrix combination by combination", () => {
			const axes = Object.entries(file.matrix ?? {}).map(
				([axis, values]): [string, string[]] => [
					axis,
					options.matrix ? options.matrix(axis, values) : values,
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
		test("every hook of these tabs is in the markup", () => {
			const text = [
				...(options.files ?? []).map((name) =>
					readFileSync(join(import.meta.dir, "../../src/app", name), "utf8"),
				),
				...options.sources.flatMap((directory) =>
					readdirSync(join(import.meta.dir, "../../src/app", directory)).map(
						(name) =>
							readFileSync(
								join(import.meta.dir, "../../src/app", directory, name),
								"utf8",
							),
					),
				),
			].join("\n");
			const missing = file.hooks
				.filter((hook) => !options.otherHooks(hook))
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
				runEntry(entry, createFixtureReader({ clock: calendar }), check),
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
