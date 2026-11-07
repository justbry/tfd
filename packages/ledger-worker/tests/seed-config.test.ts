/** Landing the UI's fixtures in R2: idempotent, safe to run twice at once, and every config-backed reader has a key. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "tfd";
import { R2BindingStore } from "tfd/worker";
import {
	connectionOf,
	parseSeedArgs,
	runSeed,
	STAGING_BUCKET,
	UsageError,
} from "../scripts/seed-r2.js";
import { canonicalJson } from "../src/config/canonical.js";
import { definitions } from "../src/config/definitions.js";
import { configKey, readStored } from "../src/config/store.js";
import { CONFIG_NAMES, type ConfigManifest } from "../src/config/types.js";
import {
	type LedgerHarness,
	startLedgerWorker,
} from "../src/testing/harness.js";
import {
	fixtureObjects,
	fixtureSchoolIds,
	readerConfig,
	seedSchoolFixtures,
} from "../src/testing/seed-config.js";

const FIRST_RUN = "2026-11-07T10:00:00.000Z";
const LATER_RUN = "2026-11-07T11:00:00.000Z";
const OBJECTS_PER_SCHOOL = CONFIG_NAMES.length + 1;
const PARALLEL_RUNS = 4;

let harness: LedgerHarness;
let store: R2BindingStore;
beforeAll(async () => {
	harness = await startLedgerWorker({ presets: ["free-only"] });
	store = new R2BindingStore(harness.bucket);
}, 120_000);
afterAll(async () => {
	await harness.stop();
});

const sha256 = (text: string) =>
	createHash("sha256").update(text).digest("hex");

/** Every key under the school's config prefix with the hash of its bytes, as one digest. */
const listingHash = async (school: string): Promise<string> => {
	const keys: string[] = [];
	let cursor: string | undefined;
	do {
		const page = await store.list({
			prefix: `schools/${school}/config/`,
			cursor,
		});
		keys.push(...page.objects.map((object) => object.key));
		cursor = page.next ?? undefined;
	} while (cursor);
	const lines: string[] = [];
	for (const key of keys.sort())
		lines.push(`${key} ${(await readStored(store, key))?.sha256}`);
	return sha256(lines.join("\n"));
};

/** A store that counts the writes made through it. */
const counting = (inner: Store) => {
	const counts = { puts: 0 };
	const wrapped: Store = Object.create(inner) as Store;
	wrapped.putIfAbsent = (key, body) => {
		counts.puts += 1;
		return inner.putIfAbsent(key, body);
	};
	wrapped.putIfMatch = (key, body, etag) => {
		counts.puts += 1;
		return inner.putIfMatch(key, body, etag);
	};
	return { store: wrapped, counts };
};

describe("seedSchoolFixtures", () => {
	test("the first run writes every object and the manifest; the second writes nothing and changes no byte", async () => {
		const schools = fixtureSchoolIds().map((fixture) => ({
			id: `idem-${fixture}`,
			fixture,
		}));
		const first = await seedSchoolFixtures(store, { schools, now: FIRST_RUN });
		expect(first.written).toBe(OBJECTS_PER_SCHOOL * schools.length);
		expect(first.unchanged).toBe(0);
		const listings = await Promise.all(
			schools.map(({ id }) => listingHash(id)),
		);
		const manifests = await Promise.all(
			schools.map(
				async ({ id }) =>
					(await readStored(store, configKey(id, "manifest")))?.text,
			),
		);

		const spy = counting(store);
		const second = await seedSchoolFixtures(spy.store, {
			schools,
			now: LATER_RUN,
		});
		expect(second.written).toBe(0);
		expect(second.unchanged).toBe(OBJECTS_PER_SCHOOL * schools.length);
		expect(spy.counts.puts).toBe(0);
		expect(await Promise.all(schools.map(({ id }) => listingHash(id)))).toEqual(
			listings,
		);
		expect(
			await Promise.all(
				schools.map(
					async ({ id }) =>
						(await readStored(store, configKey(id, "manifest")))?.text,
				),
			),
		).toEqual(manifests);
		const manifest = JSON.parse(manifests[0] as string) as ConfigManifest;
		for (const entry of Object.values(manifest.objects)) {
			expect(entry.updatedAt).toBe(FIRST_RUN);
			expect(entry.updatedBy).toBe("seed");
		}
	});

	test("it rewrites only what differs: one changed object is the only write, and a manifest that is still right is left alone", async () => {
		const id = "idem-partial";
		await seedSchoolFixtures(store, {
			schools: [{ id, fixture: "b4u" }],
			now: FIRST_RUN,
		});
		const key = configKey(id, "promos");
		const stored = await readStored(store, key);
		await store.putIfMatch(
			key,
			new TextEncoder().encode("{}\n"),
			stored?.etag as string,
		);
		const kept = await seedSchoolFixtures(store, {
			schools: [{ id, fixture: "b4u" }],
			now: LATER_RUN,
		});
		// by default an object that differs is left alone: an owner may have edited it
		expect(kept.kept).toBe(1);
		// the manifest follows the bytes that are there; no config object is rewritten
		expect(
			kept.objects
				.filter((entry) => entry.action === "written")
				.map((entry) => entry.name),
		).toEqual(["manifest"]);
		expect((await readStored(store, key))?.text).toBe("{}\n");
		const report = await seedSchoolFixtures(store, {
			schools: [{ id, fixture: "b4u" }],
			now: LATER_RUN,
			overwrite: true,
		});
		expect(
			report.objects
				.filter((entry) => entry.action === "written")
				.map((entry) => entry.name),
		).toEqual(["promos", "manifest"]);
		expect((await readStored(store, key))?.text).toBe(
			canonicalJson(fixtureObjects(id, "b4u").promos),
		);
		const manifest = JSON.parse(
			(await readStored(store, configKey(id, "manifest")))?.text as string,
		) as ConfigManifest;
		expect(manifest.objects.promos?.sha256).toBe(
			sha256(canonicalJson(fixtureObjects(id, "b4u").promos)),
		);
	});

	test("runs at the same time are safe: each object is written once and the end state is the fixture's", async () => {
		const id = "race";
		const runs = await Promise.all(
			Array.from({ length: PARALLEL_RUNS }, (_, index) =>
				seedSchoolFixtures(store, {
					schools: [{ id, fixture: "vol" }],
					now: new Date(Date.parse(FIRST_RUN) + index * 1000),
				}),
			),
		);
		const objectWrites = runs
			.flatMap((run) => run.objects)
			.filter(
				(entry) => entry.name !== "manifest" && entry.action === "written",
			);
		expect(objectWrites).toHaveLength(CONFIG_NAMES.length);
		expect(new Set(objectWrites.map((entry) => entry.name)).size).toBe(
			CONFIG_NAMES.length,
		);
		const objects = fixtureObjects(id, "vol");
		for (const name of CONFIG_NAMES)
			expect((await readStored(store, configKey(id, name)))?.text).toBe(
				canonicalJson(objects[name]),
			);
		const manifest = JSON.parse(
			(await readStored(store, configKey(id, "manifest")))?.text as string,
		) as ConfigManifest;
		for (const name of CONFIG_NAMES) {
			const stored = await readStored(store, configKey(id, name));
			expect(manifest.objects[name]?.sha256).toBe(stored?.sha256 as string);
			expect(manifest.objects[name]?.bytes).toBe(stored?.bytes as number);
		}
		const after = await seedSchoolFixtures(store, {
			schools: [{ id, fixture: "vol" }],
			now: LATER_RUN,
		});
		expect(after.written).toBe(0);
		expect(after.unchanged).toBe(OBJECTS_PER_SCHOOL);
	});

	test("a dry run reads only, and says what it would write", async () => {
		const spy = counting(store);
		const id = "dry";
		const report = await seedSchoolFixtures(spy.store, {
			schools: [{ id, fixture: "map" }],
			now: FIRST_RUN,
			dryRun: true,
		});
		expect(spy.counts.puts).toBe(0);
		expect(report).toMatchObject({
			written: 0,
			unchanged: 0,
			wouldWrite: OBJECTS_PER_SCHOOL,
		});
		expect(await readStored(store, configKey(id, "settings"))).toBeNull();
		await seedSchoolFixtures(store, {
			schools: [{ id, fixture: "map" }],
			now: FIRST_RUN,
		});
		const again = await seedSchoolFixtures(spy.store, {
			schools: [{ id, fixture: "map" }],
			now: LATER_RUN,
			dryRun: true,
		});
		expect(again).toMatchObject({
			written: 0,
			wouldWrite: 0,
			unchanged: OBJECTS_PER_SCHOOL,
		});
	});

	test("a school the fixtures do not describe is refused before anything is written", async () => {
		const spy = counting(store);
		await expect(
			seedSchoolFixtures(spy.store, { schools: ["nope"], now: FIRST_RUN }),
		).rejects.toThrow("settings for nope");
		expect(spy.counts.puts).toBe(0);
	});

	test("every fixture object passes the Worker's own validators, and the settings rules equal the rules object", () => {
		for (const fixture of fixtureSchoolIds()) {
			const objects = fixtureObjects(fixture, fixture);
			for (const name of CONFIG_NAMES)
				expect(definitions[name].validate(objects[name], fixture)).toEqual([]);
		}
	});
});

/** The readers of `http/reader.ts` that no config object backs: the Worker or the family service answers them, or they say not available. */
const NOT_CONFIG_BACKED = [
	"planSummary_counts",
	"people",
	"membersSummary",
	"memberDetail",
	"auditMember",
	"donors",
	"memberPortal",
];
const READER = join(import.meta.dir, "../../ledger-ui/src/http/reader.ts");

describe("the UI's readers and the seeded keys", () => {
	test("settings, schoolRules, promos and planSummary each have a config key that the seeder writes", async () => {
		const report = await seedSchoolFixtures(store, {
			schools: [{ id: "mapping", fixture: "vol" }],
			now: FIRST_RUN,
		});
		const seeded = new Set(report.objects.map((entry) => entry.name));
		for (const reader of ["settings", "schoolRules", "promos", "planSummary"]) {
			const names = readerConfig[reader];
			expect(names, `${reader} has no config key`).toBeDefined();
			expect(names?.length).toBeGreaterThan(0);
			for (const name of names ?? []) {
				expect(
					seeded.has(name),
					`${reader} reads ${name}, which is not seeded`,
				).toBe(true);
				expect(
					await readStored(store, configKey("mapping", name)),
				).not.toBeNull();
			}
		}
	});

	test("a reader the UI leaves unavailable is either backed by a config object or on the list that stays unavailable", () => {
		const source = readFileSync(READER, "utf8");
		const unavailable = [
			...source.matchAll(/unavailable\(\s*"([A-Za-z]+)"/g),
		].map((match) => match[1] as string);
		expect(unavailable.length).toBeGreaterThan(0);
		for (const reader of unavailable)
			expect(
				reader in readerConfig || NOT_CONFIG_BACKED.includes(reader),
				`${reader} is unavailable in reader.ts and has no config key: add it to readerConfig or to NOT_CONFIG_BACKED`,
			).toBe(true);
		for (const reader of Object.keys(readerConfig))
			expect(source, `reader.ts no longer mentions ${reader}`).toContain(
				`${reader}:`,
			);
	});
});

describe("the seed:r2 command", () => {
	const ENV = {
		R2_LEDGER_ENDPOINT: "https://account.r2.cloudflarestorage.com",
		R2_LEDGER_BUCKET: STAGING_BUCKET,
		R2_LEDGER_ACCESS_KEY_ID: "test-key-id",
		R2_LEDGER_SECRET_ACCESS_KEY: "test-secret",
	};
	const run = async (
		argv: string[],
		env: Record<string, string | undefined> = ENV,
	) => {
		const output: string[] = [];
		const code = await runSeed({
			argv,
			env,
			now: () => new Date(FIRST_RUN),
			write: (text) => output.push(text),
			storeFor: () => store,
		});
		return { code, text: output.join("") };
	};

	test("a dry run lists what it would write, writes nothing and prints no credential", async () => {
		const spy = counting(store);
		const output: string[] = [];
		const code = await runSeed({
			argv: ["--env", "staging", "--school", "nw", "--dry-run"],
			env: ENV,
			now: () => new Date(FIRST_RUN),
			write: (text) => output.push(text),
			storeFor: () => spy.store,
		});
		const text = output.join("");
		expect(code).toBe(0);
		expect(spy.counts.puts).toBe(0);
		expect(text).toContain(`seed:r2 ${STAGING_BUCKET} (dry run)`);
		expect(text).toContain("dry run: would-write:6 unchanged:0 kept:0");
		for (const secret of [
			ENV.R2_LEDGER_ACCESS_KEY_ID,
			ENV.R2_LEDGER_SECRET_ACCESS_KEY,
			"account.r2",
		])
			expect(text).not.toContain(secret);
	});

	test("a real run on Miniflare reports written:N, then written:0 unchanged:N", async () => {
		const first = await run(["--school", "har"]);
		expect(first.code).toBe(0);
		expect(first.text).toContain("written:6 unchanged:0 kept:0");
		const second = await run(["--school", "har"]);
		expect(second.text).toContain(
			`written:0 unchanged:${OBJECTS_PER_SCHOOL} kept:0`,
		);
	});

	test("production, another bucket, another host and a missing variable are refused before any store is made", async () => {
		const refused = async (
			argv: string[],
			env: Record<string, string | undefined>,
			fragment: string,
		) => {
			const output: string[] = [];
			let made = 0;
			const code = await runSeed({
				argv,
				env,
				now: () => new Date(FIRST_RUN),
				write: (text) => output.push(text),
				storeFor: () => {
					made += 1;
					return store;
				},
			});
			expect(code).toBe(2);
			expect(made).toBe(0);
			expect(output.join("")).toContain(fragment);
			for (const secret of [
				ENV.R2_LEDGER_ACCESS_KEY_ID,
				ENV.R2_LEDGER_SECRET_ACCESS_KEY,
			])
				expect(output.join("")).not.toContain(secret);
		};
		await refused(["--env", "production"], ENV, "seeds staging only");
		await refused(["--env", "prod"], ENV, "seeds staging only");
		await refused(
			[],
			{ ...ENV, R2_LEDGER_BUCKET: "b4uni-prod-ledger" },
			"only b4uni-stg-ledger",
		);
		await refused(
			[],
			{ ...ENV, R2_LEDGER_BUCKET: "b4uni-stg-ledger-copy" },
			"only b4uni-stg-ledger",
		);
		await refused(
			[],
			{
				...ENV,
				R2_LEDGER_ENDPOINT: "http://account.r2.cloudflarestorage.com",
			},
			"https",
		);
		await refused(
			[],
			{ ...ENV, R2_LEDGER_ENDPOINT: "https://evil.example.com" },
			"r2.cloudflarestorage.com",
		);
		await refused(
			[],
			{ ...ENV, R2_LEDGER_SECRET_ACCESS_KEY: undefined },
			"R2_LEDGER_SECRET_ACCESS_KEY",
		);
		await refused(["--school", "unknown"], ENV, "--school unknown");
		await refused(["--frob"], ENV, "unknown argument");
	});

	test("arguments: every fixture school by default, and the connection is the staging one", () => {
		expect(parseSeedArgs([])).toEqual({
			schools: fixtureSchoolIds(),
			dryRun: false,
			overwrite: false,
		});
		expect(parseSeedArgs(["--overwrite"]).overwrite).toBe(true);
		expect(
			parseSeedArgs(["--school", "vol", "--school", "nw", "--dry-run"]),
		).toEqual({
			schools: ["vol", "nw"],
			dryRun: true,
			overwrite: false,
		});
		expect(connectionOf(ENV).bucket).toBe(STAGING_BUCKET);
		expect(() => connectionOf({})).toThrow(UsageError);
	});
});
