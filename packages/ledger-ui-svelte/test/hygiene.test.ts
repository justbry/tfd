import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** Gate H for the Svelte package (S9-plan sections 5 and 6): Worker-safe, no logging, no storage, no clock reads,
 * never silent, and the D20 import rule (the Preact package's contract, fixtures and adapters are imported read-only,
 * and only the parts that carry no Preact). */
const packageRoot = join(import.meta.dir, "..");
const sourceRoot = join(packageRoot, "src");

const filesUnder = (directory: string): string[] =>
	existsSync(directory)
		? readdirSync(directory).flatMap((name) => {
				const path = join(directory, name);
				return statSync(path).isDirectory() ? filesUnder(path) : [path];
			})
		: [];

const forbiddenInSource: ReadonlyArray<readonly [string, RegExp]> = [
	["ajv", /\bajv\b/],
	["node: import", /["']node:/],
	["new Function", /new\s+Function\s*\(/],
	["eval(", /\beval\s*\(/],
	["console.", /\bconsole\./],
	["debugger", /\bdebugger\b/],
	["innerHTML", /\binnerHTML\b/],
	["{@html}", /\{@html\b/],
	["localStorage", /\blocalStorage\b/],
	["sessionStorage", /\bsessionStorage\b/],
	["indexedDB", /\bindexedDB\b/],
	["zod", /["']zod["']/],
	["Date.now(", /Date\.now\s*\(/],
	["new Date()", /new\s+Date\s*\(\s*\)/],
	["preact", /["']preact/],
];
/** The HTTP build's entry keeps pending writes in the browser's persistent storage and reads the system time once,
 * at mount, for its calendar (as the Preact package's src/http/browser.ts). Every other file keeps every rule. */
const allowedInSource: ReadonlyMap<string, ReadonlySet<string>> = new Map([
	["src/http-entry.ts", new Set(["localStorage", "Date.now("])],
]);

/** Never silent: an empty catch, a promise catch that drops the error, or an effect that ignores its failure. */
const silentPatterns: ReadonlyArray<readonly [string, RegExp]> = [
	["empty catch", /catch\s*(\([^)]*\))?\s*\{\s*\}/],
	[
		".catch(() => {})",
		/\.catch\(\s*(\(\s*\w*\s*\)|\w+)\s*=>\s*(\{\s*\}|undefined|null|void 0)\s*\)/,
	],
	["Effect.ignore", /Effect\.ignore\b/],
	[
		"catchAll to void",
		/Effect\.catch(All)?\(\s*\(\s*\w*\s*\)\s*=>\s*Effect\.void\s*\)/,
	],
];

const allowedPackages = [
	/^svelte(\/.*)?$/,
	/^effect$/,
	/^bits-ui$/,
	/^clsx$/,
	/^tailwind-merge$/,
	/^tailwind-variants$/,
	/^tailwindcss$/,
	// A pane's own stylesheet takes Tailwind's theme and utilities without its base (app.css has it once).
	/^tailwindcss\/(theme|utilities)\.css$/,
	/^tw-animate-css$/,
];
/** What the app may take from the Preact package: its contract and adapters, and the two pure route and period
 * modules. Not its UI, not the HTTP entry that mounts Preact. */
const allowedContract = [
	/^data\/[a-z-]+\.ts$/,
	/^http\/(?!browser\.ts$)[a-z-]+\.ts$/,
	/^fixtures\/[a-z-]+\.ts$/,
	/^app\/(route|period)\.ts$/,
];
/** The ledger Worker's config modules the ConfigClient takes read-only (`$worker-config`): its types, validators,
 * canonical JSON and diff, which carry no Worker runtime. */
const allowedWorkerConfig = [/^(canonical|definitions|diff|types|validate)\.ts$/];
/** Only the fixture layer reads the fixtures. */
const fixtureImporters = new Set(["src/effect/layers.ts"]);

const importPattern =
	/(?:import|export)\s[^"']*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']|@import\s+["']([^"']+)["']/g;

const sourceFiles = filesUnder(sourceRoot).filter((file) =>
	/\.(ts|svelte|css)$/.test(file),
);
const packageFiles = [
	...sourceFiles,
	...["test", "scripts", "gates"].flatMap((directory) =>
		filesUnder(join(packageRoot, directory)).filter((file) =>
			/\.ts$/.test(file),
		),
	),
];

describe("gate H: source", () => {
	test("the app has source files", () => {
		expect(sourceFiles.length).toBeGreaterThan(20);
	});
	for (const file of sourceFiles) {
		const name = relative(packageRoot, file);
		const text = readFileSync(file, "utf8");
		test(`${name} has no forbidden construct`, () => {
			const allowed = allowedInSource.get(name) ?? new Set<string>();
			const found = forbiddenInSource
				.filter(([label, pattern]) => !allowed.has(label) && pattern.test(text))
				.map(([label]) => label);
			expect(found).toEqual([]);
		});
		test(`${name} follows the import rule`, () => {
			const problems: string[] = [];
			for (const match of text.matchAll(importPattern)) {
				const specifier = match[1] ?? match[2] ?? match[3] ?? match[4] ?? "";
				if (specifier.startsWith(".") || specifier.startsWith("$lib/"))
					continue;
				if (specifier.startsWith("$contract/")) {
					const target = specifier.slice("$contract/".length);
					if (!allowedContract.some((pattern) => pattern.test(target)))
						problems.push(`contract ${target}`);
					if (target.startsWith("fixtures/") && !fixtureImporters.has(name))
						problems.push(`only the fixture layer reads fixtures: ${target}`);
					continue;
				}
				if (specifier.startsWith("$worker-config/")) {
					const target = specifier.slice("$worker-config/".length);
					if (!allowedWorkerConfig.some((pattern) => pattern.test(target)))
						problems.push(`worker config ${target}`);
					continue;
				}
				if (!allowedPackages.some((pattern) => pattern.test(specifier)))
					problems.push(`package ${specifier}`);
			}
			expect(problems).toEqual([]);
		});
	}
});

describe("gate H: never silent", () => {
	for (const file of packageFiles) {
		const name = relative(packageRoot, file);
		if (name === "test/hygiene.test.ts") continue;
		test(`${name} drops no error`, () => {
			const text = readFileSync(file, "utf8");
			const found = silentPatterns
				.filter(([, pattern]) => pattern.test(text))
				.map(([label]) => label);
			expect(found).toEqual([]);
		});
	}
	test("the patterns catch what they name", () => {
		const caught = (sample: string) =>
			silentPatterns
				.filter(([, pattern]) => pattern.test(sample))
				.map(([label]) => label);
		expect(caught("try { a() } catch {}")).toEqual(["empty catch"]);
		expect(caught("try { a() } catch (error) {  }")).toEqual(["empty catch"]);
		expect(caught("load().catch(() => {})")).toEqual([".catch(() => {})"]);
		expect(caught("load().catch((_error) => undefined)")).toEqual([
			".catch(() => {})",
		]);
		expect(caught("effect.pipe(Effect.ignore)")).toEqual(["Effect.ignore"]);
		expect(caught("Effect.catch(() => Effect.void)")).toEqual([
			"catchAll to void",
		]);
		expect(caught("try { a() } catch (error) { report(error) }")).toEqual([]);
	});
});

describe("gate H: the HTTP entry's allowance", () => {
	test("only src/http-entry.ts uses storage or the system time, and reads the time once", () => {
		const users = sourceFiles.filter((file) => {
			const text = readFileSync(file, "utf8");
			return /\blocalStorage\b|Date\.now\s*\(/.test(text);
		});
		expect(users.map((file) => relative(packageRoot, file))).toEqual([
			"src/http-entry.ts",
		]);
		const entry = readFileSync(join(sourceRoot, "http-entry.ts"), "utf8");
		expect(entry.match(/Date\.now\s*\(/g)?.length).toBe(1);
	});
});

describe("gate H: build", () => {
	const buildFiles = [
		...filesUnder(join(packageRoot, "dist-size")),
		...filesUnder(join(packageRoot, "dist")),
	].filter((file) => /\.(js|css)$/.test(file));
	test.if(buildFiles.length > 0)(
		"the builds have no Worker-unsafe construct",
		() => {
			const forbiddenInBuild: ReadonlyArray<readonly [string, RegExp]> = [
				["new Function", /new\s+Function\s*\(/],
				["eval(", /\beval\s*\(/],
				["node: import", /["']node:/],
				["ajv", /\bajv\b/],
				["zod", /["']zod["']/],
			];
			const found = buildFiles.flatMap((file) => {
				const text = readFileSync(file, "utf8");
				return forbiddenInBuild
					.filter(([, pattern]) => pattern.test(text))
					.map(([label]) => `${relative(packageRoot, file)}: ${label}`);
			});
			expect(found).toEqual([]);
		},
	);
});
