/**
 * `wrangler deploy --dry-run` for both environments: the bundle builds and the bindings resolve. The config serves the UI
 * from `../ledger-ui/dist`, which wrangler needs to exist, so the check builds the UI first when it can (its own
 * dependencies installed) and otherwise points `--assets` at a placeholder page; it says which.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const WRANGLER = "wrangler@4.90.0";
const root = resolve(import.meta.dir, "..");
const ui = resolve(root, "../ledger-ui");
const built = join(ui, "dist");

const run = async (command: string[], cwd: string): Promise<boolean> => {
	const process = Bun.spawn(command, {
		cwd,
		stdout: "inherit",
		stderr: "inherit",
	});
	return (await process.exited) === 0;
};

const uiAssets = async (): Promise<string | null> => {
	if (existsSync(join(built, "index.html"))) return built;
	if (
		existsSync(join(ui, "node_modules")) &&
		(await run(["bun", "run", "build"], ui))
	)
		return existsSync(join(built, "index.html")) ? built : null;
	return null;
};

const assets = await uiAssets();
let assetsFlag: string[] = [];
if (assets === null) {
	const placeholder = join(root, "dist/placeholder-assets");
	await mkdir(placeholder, { recursive: true });
	await writeFile(
		join(placeholder, "index.html"),
		"<!doctype html><title>ledger</title>\n",
	);
	assetsFlag = ["--assets", placeholder];
	console.warn(
		"check:bundle: the UI is not built here; checking with a placeholder page as the assets",
	);
}

for (const environment of ["staging", "production"]) {
	const ok = await run(
		[
			"bunx",
			WRANGLER,
			"deploy",
			"--dry-run",
			"--outdir",
			`dist/${environment}`,
			"--env",
			environment,
			...assetsFlag,
		],
		root,
	);
	if (!ok) process.exit(1);
}
