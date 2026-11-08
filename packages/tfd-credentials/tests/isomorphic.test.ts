import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// src/ must load in Bun, Node 20+, Cloudflare Workers and browsers: no Node or Bun built-ins, no Buffer, and no code
// generation (Workers refuse eval and new Function). tsconfig.build.json enforces the same at the type level.
const FORBIDDEN: [string, RegExp][] = [
	["a node: import", /from\s+["']node:|import\(\s*["']node:/],
	[
		"a bare Node built-in import",
		/from\s+["'](fs|path|crypto|os|zlib|buffer|stream|util)["']/,
	],
	["Buffer", /\bBuffer\b/],
	["eval", /\beval\s*\(/],
	["new Function", /\bnew\s+Function\b/],
	["the Bun global", /\bBun\./],
	["process", /\bprocess\.(env|argv|exit|hrtime)/],
	["require", /\brequire\s*\(/],
	["a clock", /\bDate\.now\s*\(|new Date\(\s*\)|performance\.now/],
	[
		"ambient randomness",
		/Math\.random|crypto\.getRandomValues|crypto\.randomUUID/,
	],
	["the network", /\bfetch\s*\(|XMLHttpRequest|WebSocket/],
	["console", /\bconsole\./],
];

const sourceFiles = (directory: string): string[] =>
	readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return sourceFiles(path);
		return entry.name.endsWith(".ts") ? [path] : [];
	});

const SOURCE = join(import.meta.dir, "../src");

/** The code without block comments and comment-only lines, so prose about Buffer or eval does not count. */
const codeOf = (text: string): string =>
	text
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.split("\n")
		.filter((line) => !line.trimStart().startsWith("//"))
		.join("\n");

test("src has no runtime-specific APIs, clock, ambient randomness or network", () => {
	const findings: string[] = [];
	for (const file of sourceFiles(SOURCE)) {
		const text = codeOf(readFileSync(file, "utf8"));
		for (const [what, pattern] of FORBIDDEN) {
			if (pattern.test(text))
				findings.push(`${relative(SOURCE, file)}: ${what}`);
		}
	}
	expect(findings).toEqual([]);
});

const thirdPartyImports = (file: string): string[] =>
	[
		...readFileSync(file, "utf8").matchAll(/from\s+["']([^"'.][^"']*)["']/g),
	].map((match) => match[1] as string);

test("third-party imports: @noble everywhere, jsonld only under src/rdfc", () => {
	const core = new Set<string>();
	const rdfc = new Set<string>();
	for (const file of sourceFiles(SOURCE)) {
		const target = relative(SOURCE, file).startsWith("rdfc/") ? rdfc : core;
		for (const name of thirdPartyImports(file)) target.add(name);
	}
	expect([...core].sort()).toEqual([
		"@noble/curves/ed25519.js",
		"@noble/hashes/sha2.js",
	]);
	expect([...rdfc]).toEqual(["jsonld"]);
});

/** Every src file the main entry reaches through relative imports. */
const reachable = (entry: string, seen = new Set<string>()): Set<string> => {
	if (seen.has(entry)) return seen;
	seen.add(entry);
	const text = readFileSync(entry, "utf8");
	for (const match of text.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
		const target = join(
			entry,
			"..",
			(match[1] as string).replace(/\.js$/, ".ts"),
		);
		if (target.endsWith(".ts")) reachable(target, seen);
	}
	return seen;
};

test("the main and testing entries never reach JSON-LD", () => {
	for (const entry of ["index.ts", "testing.ts"]) {
		const files = [...reachable(join(SOURCE, entry))].map((file) =>
			relative(SOURCE, file),
		);
		expect(files.length).toBeGreaterThan(entry === "index.ts" ? 20 : 5);
		expect(files.filter((file) => file.startsWith("rdfc"))).toEqual([]);
	}
});

test("no file is a sprawling monolith", () => {
	for (const file of sourceFiles(SOURCE)) {
		expect({
			file: relative(SOURCE, file),
			lines: readFileSync(file, "utf8").split("\n").length < 400,
		}).toEqual({
			file: relative(SOURCE, file),
			lines: true,
		});
	}
});
