import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const COMMENT_LINE = /^\s*\/\/.*$/gm;

const readConfig = async (dir: string) =>
	JSON.parse(
		(
			await Bun.file(join(import.meta.dir, dir, "wrangler.jsonc")).text()
		).replace(COMMENT_LINE, ""),
	);

/**
 * The top level of each wrangler.jsonc is production. Until the launch gate (PLAN.md section 10) it may hold only these
 * keys: no route, binding, variable or trigger can appear there without failing this test.
 */
const CLOUD_TOP_LEVEL = [
	"name",
	"main",
	"compatibility_date",
	"compatibility_flags",
	"workers_dev",
	"observability",
	"durable_objects",
	"migrations",
	"env",
];
const VERIFY_TOP_LEVEL = [
	"name",
	"compatibility_date",
	"workers_dev",
	"observability",
	"assets",
	"env",
];

describe("production stays unbound until the launch gate", () => {
	test("trifold-cloud's top level holds only the allowed keys, and staging is the only environment", async () => {
		const config = await readConfig("..");
		expect(Object.keys(config).sort()).toEqual([...CLOUD_TOP_LEVEL].sort());
		expect(config.workers_dev).toBe(false);
		expect(Object.keys(config.env)).toEqual(["staging"]);
		// The org Durable Object is SQLite-backed (its storage is the tfd handler's database, PLAN.md section 3.1).
		expect(config.migrations).toEqual([
			{ tag: "v1", new_sqlite_classes: ["OrgDO"] },
		]);
	});

	test("trifold-verify's top level holds only the allowed keys, and staging is the only environment", async () => {
		const config = await readConfig("../../trifold-verify");
		expect(Object.keys(config).sort()).toEqual([...VERIFY_TOP_LEVEL].sort());
		expect(config.workers_dev).toBe(false);
		expect(Object.keys(config.env)).toEqual(["staging"]);
		expect(config.env.staging.routes).toEqual([
			{ pattern: "staging-verify.trifold.app", custom_domain: true },
		]);
	});

	test("staging binds only staging hosts and resources", async () => {
		const staging = (await readConfig("..")).env.staging;
		expect(
			staging.routes.map((route: { pattern: string }) => route.pattern),
		).toEqual(["staging-ledger.trifold.app", "staging-api.trifold.app"]);
		expect(
			staging.d1_databases.map(
				(d1: { database_name: string }) => d1.database_name,
			),
		).toEqual(["trifold-cloud-staging"]);
		expect(
			staging.r2_buckets.map(
				(bucket: { bucket_name: string }) => bucket.bucket_name,
			),
		).toEqual(["trifold-staging-books", "trifold-staging-backups"]);
		expect(staging.vars.ENVIRONMENT).toBe("staging");
		expect(
			staging.secrets_store_secrets.map(
				(secret: { binding: string; secret_name: string }) => [
					secret.binding,
					secret.secret_name,
				],
			),
		).toEqual([
			["SIGNING_RECEIPT", "TRIFOLD_STAGING_SIGNING_RECEIPT"],
			["SIGNING_SEAL", "TRIFOLD_STAGING_SIGNING_SEAL"],
			["SIGNING_DIRECTORY", "TRIFOLD_STAGING_SIGNING_DIRECTORY"],
		]);
	});
});
