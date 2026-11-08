import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import "./svelte-plugin.ts";

/** Svelte, bits-ui and esm-env pick their browser builds by the `browser` export condition, which bunfig cannot set:
 * without `--conditions browser` (as `bun run test` passes) every component would get the server build. */
if (!Bun.resolveSync("svelte", import.meta.dir).endsWith("index-client.js"))
	throw new Error(
		"run the tests with `bun test --conditions browser` (or `bun run test`): Svelte resolved its server build",
	);

/** The Preact package's mart fixtures are generated, not committed (its scripts/import-mart.ts): build them before
 * a test imports the fixture Reader. That writes only the Preact package's ignored files. */
const contractRoot = join(import.meta.dir, "..", "..", "ledger-ui");
if (!existsSync(join(contractRoot, "src/fixtures/mart/documents.json"))) {
	const result = spawnSync("bun", ["scripts/import-mart.ts"], {
		cwd: contractRoot,
		encoding: "utf8",
	});
	if (result.status !== 0)
		throw new Error(`could not generate the mart fixtures:\n${result.stderr}`);
}

GlobalRegistrator.register({ url: "https://ledger.test/" });
