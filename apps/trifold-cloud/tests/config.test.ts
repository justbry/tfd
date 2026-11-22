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
		// The org Durable Object is SQLite-backed (its storage is the tfd handler's database, PLAN.md section 3.1); so is
		// the per-note one (`src/notes/note-do.ts`), added in its own migration step.
		expect(config.migrations).toEqual([
			{ tag: "v1", new_sqlite_classes: ["OrgDO"] },
			{ tag: "v2", new_sqlite_classes: ["NoteDO"] },
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
		expect(staging.triggers.crons).toEqual(["17 * * * *"]);
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

	test("staging carries the note key ids and the published public keys as plain vars, and no secret", async () => {
		const staging = (await readConfig("..")).env.staging;
		const { vars } = staging;
		const published = JSON.parse(
			await Bun.file(
				join(
					import.meta.dir,
					"../../trifold-verify/public/.well-known/trifold-keys.json",
				),
			).text(),
		) as Record<string, { pem: string; purpose: string }>;
		const idOf = (purpose: string): string | undefined =>
			Object.entries(published).find(([, key]) => key.purpose === purpose)?.[0];
		expect(vars.NOTES_RECEIPT_KEY_ID).toBe(idOf("receipt"));
		expect(vars.NOTES_SEAL_KEY_ID).toBe(idOf("seal"));
		expect(vars.NOTES_RECEIPT_KEY_ID).toBe("trifold-staging-2026-11-receipt");
		expect(vars.NOTES_SEAL_KEY_ID).toBe("trifold-staging-2026-11-seal");
		// The public keys are exactly the published ones for those two ids: same PEM, same purpose.
		const keys = JSON.parse(vars.NOTES_PUBLIC_KEYS_JSON) as Record<
			string,
			{ pem: string; purpose: string }
		>;
		expect(Object.keys(keys).sort()).toEqual(
			[vars.NOTES_RECEIPT_KEY_ID, vars.NOTES_SEAL_KEY_ID].sort(),
		);
		for (const [id, key] of Object.entries(keys)) {
			expect(key.pem).toBe(published[id]?.pem as string);
			expect(key.pem).toStartWith("-----BEGIN PUBLIC KEY-----");
			expect(key.purpose).toBe(published[id]?.purpose as string);
		}
		// Secrets stay out of the file: the session secret and the API key are Worker secrets, put by hand.
		for (const secret of [
			"NOTES_SESSION_SECRET",
			"NOTES_API_KEY",
			"STRIPE_SECRET_KEY",
			"STRIPE_BILLING_WEBHOOK_SECRET",
		])
			expect(Object.keys(vars)).not.toContain(secret);
		expect(JSON.stringify(vars)).not.toMatch(/PRIVATE KEY/);
		// The top level (production) has no vars at all.
		expect((await readConfig("..")).vars).toBeUndefined();
	});
});

describe("note mail goes out through Email Service, on staging only", () => {
	test("production has no send_email binding and no mail var; staging has exactly the restricted EMAIL binding and the sender var", async () => {
		const config = await readConfig("..");
		expect(config.send_email).toBeUndefined();
		expect(config.vars).toBeUndefined();
		expect(config.env.staging.send_email).toEqual([
			{ name: "EMAIL", allowed_sender_addresses: ["notes@trifold.app"] },
		]);
		expect(config.env.staging.vars.NOTES_MAIL_FROM).toBe("notes@trifold.app");
	});
});

describe("CI covers what the hosted notes build on", () => {
	test("the workflow runs on a change to the note libraries and the lockfile, and tests them", async () => {
		const workflow = await Bun.file(
			join(import.meta.dir, "../../../.github/workflows/trifold-cloud.yml"),
		).text();
		// Once under pull_request and once under push.
		for (const path of [
			"packages/tfd-notes/**",
			"packages/verify-notes/**",
			"packages/verify/**",
			"packages/atm/**",
			"bun.lock",
		])
			expect({ path, count: workflow.split(`- ${path}\n`).length - 1 }).toEqual(
				{
					path,
					count: 2,
				},
			);
		expect(workflow).toContain(
			"(cd packages/verify-notes && bun test tests && bunx tsc --noEmit)",
		);
		expect(workflow).toContain("(cd packages/verify && bun test tests)");
		expect(workflow).toContain("(cd packages/tfd-notes && bun test tests)");
	});
});
