/**
 * The local gates of the Svelte package (S9-plan section 2), in the order of packages/ledger-ui/gates/run.ts. Usage,
 * from packages/ledger-ui-svelte:
 *   bun gates/run.ts --slice S9.0 [--base origin/dev]
 * I frozen install, F the contract's fixtures, Y types (svelte-check), B Biome on the package's files changed since
 * `--base`, S first-load size against gates/budget.json, T every test group (bun run test, hygiene included), K
 * computed styles in a real browser (scripts/check-styles.ts: the built app served by `vite preview` on port
 * `--style-port`, 5399 by default; happy-dom has no cascade, so only a browser can see a rule that a later stylesheet
 * overrides). K needs the Chromium headless shell and playwright-core in /tmp/ledger-shots that scripts/shots.ts uses:
 * without them it is red, unless `--skip-browser` says this machine has none. Stops at the first red gate.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { gzipSync } from "node:zlib";

const argument = (name: string, fallback?: string): string => {
	const index = process.argv.indexOf(name);
	const value = (index > 0 ? process.argv[index + 1] : undefined) ?? fallback;
	if (!value) throw new Error(`missing ${name}`);
	return value;
};
const slice = argument("--slice");
const base = argument("--base", "origin/dev");
const sliceMatch = /^S9\.(\d+)$/.exec(slice);
if (!sliceMatch) throw new Error(`--slice is S9.<k>, not ${slice}`);
const sliceNumber = Number(sliceMatch[1]);
const packageRoot = join(import.meta.dir, "..");
const repositoryRoot = join(packageRoot, "..", "..");
const packagePath = relative(repositoryRoot, packageRoot);

type Budget = {
	firstCeiling: number;
	growth: number;
	sizes: Record<string, number>;
};

const run = (
	gate: string,
	command: string,
	args: string[],
	cwd = packageRoot,
): void => {
	const result = spawnSync(command, args, { cwd, encoding: "utf8" });
	const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
	if (result.status !== 0) {
		process.stdout.write(
			`${gate} red: ${command} ${args.join(" ")}\n${output}\n`,
		);
		process.exit(1);
	}
	const tail = output.split("\n").slice(-2).join(" | ");
	process.stdout.write(`${gate} green${tail ? `: ${tail}` : ""}\n`);
};

process.stdout.write(`slice ${slice}, changes since ${base}\n`);
run("I install", "bun", ["install", "--frozen-lockfile"]);
run("F fixtures", "bun", ["run", "fixtures"]);
run("Y types", "bun", ["run", "typecheck"]);

const changed = spawnSync(
	"git",
	["diff", "--name-only", `${base}...HEAD`, "--", packagePath],
	{ cwd: repositoryRoot, encoding: "utf8" },
);
const uncommitted = spawnSync(
	"git",
	["status", "--porcelain", "--untracked-files=all", "--", packagePath],
	{ cwd: repositoryRoot, encoding: "utf8" },
);
const lintable = [
	...new Set([
		...changed.stdout.split("\n"),
		...uncommitted.stdout.split("\n").map((line) => line.slice(3)),
	]),
]
	.map((path) => path.trim())
	.filter((path) => /\.(ts|js|json|css|svelte)$/.test(path))
	.filter((path) => !path.endsWith("bun.lock"))
	.filter((path) => existsSync(join(repositoryRoot, path)));
const biome = join(packageRoot, "node_modules/.bin/biome");
const pinned = JSON.parse(
	readFileSync(join(repositoryRoot, "package.json"), "utf8"),
).devDependencies["@biomejs/biome"];
const version = spawnSync(biome, ["--version"], {
	encoding: "utf8",
}).stdout.trim();
if (!version.endsWith(pinned)) {
	process.stdout.write(
		`B red: biome ${version} is not the root pin ${pinned}\n`,
	);
	process.exit(1);
}
if (lintable.length)
	run(
		"B biome",
		biome,
		["check", "--no-errors-on-unmatched", ...lintable],
		repositoryRoot,
	);
else process.stdout.write("B green: no lintable changed files\n");

run("S build", "bun", ["run", "build:size"]);
type ManifestChunk = {
	file: string;
	css?: string[];
	imports?: string[];
	isEntry?: boolean;
};
const manifest = JSON.parse(
	readFileSync(join(packageRoot, "dist-size/.vite/manifest.json"), "utf8"),
) as Record<string, ManifestChunk>;
const firstLoad = new Set<string>();
const visit = (key: string): void => {
	const chunk = manifest[key];
	if (!chunk || firstLoad.has(chunk.file)) return;
	firstLoad.add(chunk.file);
	for (const css of chunk.css ?? []) firstLoad.add(css);
	for (const imported of chunk.imports ?? []) visit(imported);
};
for (const [key, chunk] of Object.entries(manifest))
	if (chunk.isEntry) visit(key);
const bytes = [...firstLoad].reduce(
	(total, file) =>
		total +
		gzipSync(readFileSync(join(packageRoot, "dist-size", file)), { level: 9 })
			.length,
	0,
);
const budget = JSON.parse(
	readFileSync(join(import.meta.dir, "budget.json"), "utf8"),
) as Budget;
const recorded = Array.from(
	{ length: sliceNumber },
	(_, index) => sliceNumber - 1 - index,
).find((number) => budget.sizes[`S9.${number}`] !== undefined);
const previous =
	recorded === undefined ? undefined : budget.sizes[`S9.${recorded}`];
const limit =
	sliceNumber === 0
		? budget.firstCeiling
		: previous === undefined || recorded === undefined
			? Number.NaN
			: Math.floor(previous * budget.growth ** (sliceNumber - recorded));
if (!(bytes <= limit)) {
	process.stdout.write(`S red: ${bytes} gzip bytes, limit ${limit}\n`);
	process.exit(1);
}
process.stdout.write(`S green: ${bytes} gzip bytes, limit ${limit}\n`);

run("T tests", "bun", ["scripts/test-all.ts"]);

if (process.argv.includes("--skip-browser"))
	process.stdout.write(
		"K skipped: --skip-browser (no Chromium on this machine)\n",
	);
else {
	const stylePort = argument("--style-port", "5399");
	run("K build", "bun", ["run", "build"]);
	const preview = spawn(
		"bunx",
		["vite", "preview", "--port", stylePort, "--strictPort"],
		{
			cwd: packageRoot,
			stdio: "ignore",
		},
	);
	const origin = `http://localhost:${stylePort}`;
	let served = false;
	for (let attempt = 0; attempt < 50 && !served; attempt += 1) {
		served = await fetch(origin).then(
			(response) => response.ok,
			() => false,
		);
		if (!served) await new Promise((resolve) => setTimeout(resolve, 200));
	}
	if (!served) {
		preview.kill();
		process.stdout.write(`K red: vite preview did not answer on ${origin}\n`);
		process.exit(1);
	}
	const styles = spawnSync(
		"bun",
		["scripts/check-styles.ts", "--app", origin],
		{
			cwd: packageRoot,
			encoding: "utf8",
		},
	);
	preview.kill();
	const output = `${styles.stdout ?? ""}${styles.stderr ?? ""}`.trim();
	if (styles.status !== 0) {
		process.stdout.write(`K red: bun scripts/check-styles.ts\n${output}\n`);
		process.exit(1);
	}
	process.stdout.write(`K green: ${output.split("\n").slice(-1)[0]}\n`);
}
process.stdout.write(`all gates green; size ${bytes}\n`);
