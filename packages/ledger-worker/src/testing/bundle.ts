/** Bundles the test Worker the way Wrangler does: esbuild, the `workerd`/`worker`/`browser` conditions, `node:*` left to `nodejs_compat`. */
import { resolve } from "node:path";
import { build } from "esbuild";

const PACKAGE = resolve(import.meta.dir, "../..");

let bundled: Promise<string> | null = null;

/** The script text; built once per process. `atm/worker` resolves to its source through atm's `bun` export condition. */
export const bundleTestWorker = (): Promise<string> => {
	bundled ??= (async () => {
		const result = await build({
			absWorkingDir: PACKAGE,
			entryPoints: ["src/testing/worker-entry.ts"],
			bundle: true,
			write: false,
			platform: "neutral",
			format: "esm",
			conditions: ["workerd", "worker", "browser", "bun"],
			mainFields: ["module", "main"],
			external: ["node:*"],
			logLevel: "warning",
			outfile: "worker.js",
		});
		const [file] = result.outputFiles;
		if (file === undefined)
			throw new Error("bundling the test Worker produced no output");
		return file.text;
	})();
	return bundled;
};
