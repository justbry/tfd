/**
 * `src/cloud.ts`, the write side's Worker entry, bundled the way Wrangler would (`worker-fixture/bundle.ts`). Like the
 * `atm/worker` bundle it must hold nothing a Worker cannot run. Unlike it, Ajv is inside (the menu and policy modules
 * import it): it is never compiled there, because the entry exports neither `validateMenu` nor `resolvePolicy`.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import * as cloud from "../src/cloud.js";
import { bundleWorker, type WorkerBundle } from "./worker-fixture/bundle.js";

const FORBIDDEN_BUILTINS = [
	"node:fs",
	"node:fs/promises",
	"node:path",
	"node:child_process",
	"node:os",
	"node:net",
	"node:http",
	"node:https",
];
const FORBIDDEN_INPUTS = [
	"src/index.ts",
	"src/ledger/duckdb.ts",
	"src/store/folder-store.ts",
];
const DYNAMIC_CODE = /(?:^|[^\w$.])eval\s*\(|new\s+Function\s*\(/g;

describe("the cloud (write side) bundle", () => {
	let bundle: WorkerBundle;
	beforeAll(async () => {
		bundle = await bundleWorker("src/cloud.ts");
	}, 60_000);

	test("holds no file system, path, child process, DuckDB or the package index", () => {
		const inputs = Object.keys(bundle.metafile.inputs);
		expect(
			bundle.nodeBuiltins.filter((name) => FORBIDDEN_BUILTINS.includes(name)),
		).toEqual([]);
		expect(inputs.filter((input) => FORBIDDEN_INPUTS.includes(input))).toEqual(
			[],
		);
		expect(bundle.packages).not.toContain("duckdb");
		expect(bundle.packages).not.toContain("@duckdb/node-api");
	});

	test("runs no eval and no `new Function`, and needs only nodejs_compat's crypto and util", () => {
		expect([...bundle.text.matchAll(DYNAMIC_CODE)].map((m) => m[0])).toEqual(
			[],
		);
		expect(bundle.nodeBuiltins).toEqual(["node:crypto", "node:util"]);
	});

	test("exports the handler, its DDL, the shipper, the R2 store and checkout, and no validator", () => {
		expect(Object.keys(cloud).sort()).toEqual([
			"HANDLER_DDL",
			"R2BindingStore",
			"checkoutParams",
			"handleStripeWebhook",
			"lookupKeyOf",
			"menuCatalogRows",
			"shipOutbox",
			"signStripePayload",
			"tierPriceKey",
			"toStripeForm",
			"verifyStripeSignature",
			"withPriceIds",
		]);
	});
});
