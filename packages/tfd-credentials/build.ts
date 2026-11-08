/**
 * Builds dist/: index.js, rdfc.js and testing.js as browser-target ESM (the target that suits Workers and browsers;
 * Bun and Node read it too), sharing chunks so `instanceof CredentialsError` holds across entrypoints, plus .d.ts per
 * module. @noble/* stay external: consumers install them as dependencies. jsonld is bundled into the rdfc entry only,
 * with one substitution: rdf-canonize's browser platform file loads the `setimmediate` polyfill, whose source holds a
 * `new Function` (for string callbacks, which rdf-canonize never passes); Workers refuse code generation, so the
 * platform file is replaced by a timer-based `setImmediate`. Usage: bun build.ts [outDir]
 */

import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { BunPlugin } from "bun";

const here = import.meta.dir;
const outDir = resolve(process.argv[2] ?? join(here, "dist"));

await rm(outDir, { recursive: true, force: true });

const RDF_CANONIZE_PLATFORM = "tfd-rdf-canonize-platform";
// rdf-canonize 5.0.0 lib/platform-browser.js, with setImmediate from a timer instead of the setimmediate polyfill.
const RDF_CANONIZE_PLATFORM_SOURCE = `
exports.setImmediate = (callback, ...args) => setTimeout(() => callback(...args), 0);
exports.crypto = globalThis.crypto;
const byteToHex = [];
for (let n = 0; n <= 0xff; ++n) byteToHex.push(n.toString(16).padStart(2, "0"));
exports.bufferToHex = (buffer) => {
	let hex = "";
	for (const byte of new Uint8Array(buffer)) hex += byteToHex[byte];
	return hex;
};
`;
const noCodeGeneration: BunPlugin = {
	name: "rdf-canonize platform without setimmediate",
	setup(build) {
		build.onResolve({ filter: /^\.\/platform(\.js)?$/ }, (args) =>
			args.importer.includes("/rdf-canonize/lib/")
				? { path: "platform", namespace: RDF_CANONIZE_PLATFORM }
				: undefined,
		);
		build.onLoad({ filter: /.*/, namespace: RDF_CANONIZE_PLATFORM }, () => ({
			contents: RDF_CANONIZE_PLATFORM_SOURCE,
			loader: "js",
		}));
	},
};

const result = await Bun.build({
	entrypoints: [
		join(here, "src/index.ts"),
		join(here, "src/rdfc.ts"),
		join(here, "src/testing.ts"),
	],
	target: "browser",
	format: "esm",
	splitting: true,
	external: [
		"@noble/curves",
		"@noble/curves/*",
		"@noble/hashes",
		"@noble/hashes/*",
	],
	plugins: [noCodeGeneration],
	outdir: outDir,
	naming: { entry: "[name].js", chunk: "chunk-[hash].js" },
});
if (!result.success) throw new AggregateError(result.logs, "bundling failed");
for (const output of result.outputs) {
	const text = await output.text();
	if (/new Function|\beval\(/.test(text)) {
		throw new Error(
			`${output.path} contains code generation, which Workers refuse`,
		);
	}
}

const tsc = Bun.spawnSync(
	[
		process.execPath,
		require.resolve("typescript/bin/tsc"),
		"-p",
		join(here, "tsconfig.build.json"),
		"--noEmit",
		"false",
		"--declaration",
		"--emitDeclarationOnly",
		"--outDir",
		outDir,
	],
	{ stdout: "inherit", stderr: "inherit" },
);
if (tsc.exitCode !== 0) throw new Error("declaration emit failed");

process.stdout.write(`built ${outDir}\n`);
