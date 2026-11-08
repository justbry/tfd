/**
 * The local gates of the Svelte package (S9-plan section 2), in the order of packages/ledger-ui/gates/run.ts. Usage,
 * from packages/ledger-ui-svelte:
 *   bun gates/run.ts --slice S9.0 [--base origin/dev]
 * I frozen install, F the contract's fixtures, Y types (svelte-check), B Biome on the package's files changed since
 * `--base`, S first-load size against gates/budget.json, T every test group (bun run test, hygiene included), K
 * computed styles in a real browser (scripts/check-styles.ts: the built app served by `vite preview` on port
 * `--style-port`, 5399 by default, the one-stylesheet reference build on the next port, and (S9.7a) the HTTP build and its
 * reference on the two after: the demo alert's states and the staging check's strings, scripts/check-http-build.ts; happy-dom has no cascade, so only a browser can see a rule that a later stylesheet
 * overrides). K needs the Chromium headless shell and playwright-core in /tmp/ledger-shots that scripts/shots.ts uses:
 * without them it is red, unless `--skip-browser` says this machine has none. Stops at the first red gate.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
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
const sliceMatch = /^S9\.(\d+)([a-z]?)$/.exec(slice);
if (!sliceMatch)
	throw new Error(`--slice is S9.<k> or S9.<k><letter>, not ${slice}`);
const sliceNumber = Number(sliceMatch[1]);
const packageRoot = join(import.meta.dir, "..");
const repositoryRoot = join(packageRoot, "..", "..");
const packagePath = relative(repositoryRoot, packageRoot);

type Budget = {
	firstCeiling: number;
	growth: number;
	sizes: Record<string, number>;
	/** A slice's own hard limit, when it is tighter than the growth rule (S9.7a: 113,700). */
	ceilings?: Record<string, number>;
};

const run = (
	gate: string,
	command: string,
	args: string[],
	cwd = packageRoot,
	environment: Record<string, string> = {},
): void => {
	const result = spawnSync(command, args, {
		cwd,
		encoding: "utf8",
		env: { ...process.env, ...environment },
	});
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
/** A lettered slice (S9.7a) follows the recording of its own number, if any, and then the slices before it. */
const searchFrom = sliceMatch[2] ? sliceNumber : sliceNumber - 1;
const recorded = Array.from(
	{ length: searchFrom + 1 },
	(_, index) => searchFrom - index,
).find((number) => budget.sizes[`S9.${number}`] !== undefined);
const previous =
	recorded === undefined ? undefined : budget.sizes[`S9.${recorded}`];
const growthLimit =
	sliceNumber === 0
		? budget.firstCeiling
		: previous === undefined || recorded === undefined
			? Number.NaN
			: Math.floor(previous * budget.growth ** (sliceNumber - recorded));
const limit = Math.min(growthLimit, budget.ceilings?.[slice] ?? growthLimit);
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
	const stylePort = Number(argument("--style-port", "5399"));
	run("K build", "bun", ["run", "build"]);
	// The reference: one stylesheet (LEDGER_SINGLE_SHEET=1), the cascade as Tailwind orders it, for the comparison.
	run(
		"K reference build",
		"bunx",
		["vite", "build", "--outDir", "tmp/dist-reference"],
		packageRoot,
		{
			LEDGER_SINGLE_SHEET: "1",
		},
	);
	// The HTTP build, as staging deploys it: the staging API host, the demo alert's words, no fixture school; and its
	// one-stylesheet reference, for the demo alert's computed styles.
	const httpEnvironment = {
		VITE_LEDGER_SOURCE: "http",
		VITE_API_BASE: "https://api-staging.b4uni.com",
	};
	run(
		"K http build",
		"bunx",
		["vite", "build", "--outDir", "tmp/dist-http"],
		packageRoot,
		httpEnvironment,
	);
	run(
		"K http reference build",
		"bunx",
		["vite", "build", "--outDir", "tmp/dist-http-reference"],
		packageRoot,
		{ ...httpEnvironment, LEDGER_SINGLE_SHEET: "1" },
	);
	run("K http bundle", "bun", [
		"scripts/check-http-build.ts",
		"tmp/dist-http",
		"dist",
	]);
	const serve = (port: number, directory: string): ChildProcess =>
		spawn(
			"bunx",
			[
				"vite",
				"preview",
				"--port",
				String(port),
				"--strictPort",
				"--outDir",
				directory,
			],
			{
				cwd: packageRoot,
				stdio: "ignore",
			},
		);
	const previews = [
		serve(stylePort, "dist"),
		serve(stylePort + 1, "tmp/dist-reference"),
		serve(stylePort + 2, "tmp/dist-http"),
		serve(stylePort + 3, "tmp/dist-http-reference"),
	];
	const origin = `http://localhost:${stylePort}`;
	const referenceOrigin = `http://localhost:${stylePort + 1}`;
	const httpOrigin = `http://localhost:${stylePort + 2}`;
	const httpReferenceOrigin = `http://localhost:${stylePort + 3}`;
	let served = false;
	for (let attempt = 0; attempt < 50 && !served; attempt += 1) {
		served = await Promise.all(
			[origin, referenceOrigin, httpOrigin, httpReferenceOrigin].map(
				(address) =>
					fetch(address).then(
						(response) => response.ok,
						() => false,
					),
			),
		).then((answers) => answers.every(Boolean));
		if (!served) await new Promise((resolve) => setTimeout(resolve, 200));
	}
	if (!served) {
		for (const preview of previews) preview.kill();
		process.stdout.write(
			`K red: vite preview did not answer on ${origin}, ${referenceOrigin}, ${httpOrigin} and ${httpReferenceOrigin}\n`,
		);
		process.exit(1);
	}
	const styles = spawnSync(
		"bun",
		[
			"scripts/check-styles.ts",
			"--app",
			origin,
			"--reference",
			referenceOrigin,
			"--http",
			httpOrigin,
			"--http-reference",
			httpReferenceOrigin,
		],
		{
			cwd: packageRoot,
			encoding: "utf8",
		},
	);
	for (const preview of previews) preview.kill();
	const output = `${styles.stdout ?? ""}${styles.stderr ?? ""}`.trim();
	if (styles.status !== 0) {
		process.stdout.write(`K red: bun scripts/check-styles.ts\n${output}\n`);
		process.exit(1);
	}
	process.stdout.write(`K green: ${output.split("\n").slice(-1)[0]}\n`);
}
process.stdout.write(`all gates green; size ${bytes}\n`);
