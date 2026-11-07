/**
 * Lands the ledger UI's fixtures in R2 as the school's config objects (`schools/<id>/config/`), idempotently: an object
 * is written only when it is absent or its sha256 differs from the fixture's, with a conditional put (`If-None-Match: *`
 * for a new object, the ETag for a changed one), so two runs at once are safe and a second run changes no byte. The
 * values are the UI package's fixtures, imported read-only; nothing here is read by the Worker. Staging, tests and the
 * `seed:r2` script use it (`scripts/seed-r2.ts`).
 */

import type { SchoolSettings } from "../../../ledger-ui/src/data/settings.ts";
import disclosureFixture from "../../../ledger-ui/src/fixtures/disclosure.json";
import {
	promosBySchool,
	rulesBySchool,
} from "../../../ledger-ui/src/fixtures/ledger-data.ts";
import { plansBySchool } from "../../../ledger-ui/src/fixtures/plans.ts";
import settingsFixture from "../../../ledger-ui/src/fixtures/settings.json";
import { bytesOf, canonicalJson, sha256Hex } from "../config/canonical.js";
import { definitions } from "../config/definitions.js";
import {
	configKey,
	expectationOf,
	putConditionally,
	readStored,
	updateManifest,
} from "../config/store.js";
import {
	CONFIG_NAMES,
	type ConfigName,
	type ConfigValues,
	type PlansDraftConfig,
	SCHEMA_VERSION,
	type SettingsConfig,
} from "../config/types.js";
import type { Store } from "../data/store-io.js";

/**
 * Which config objects each UI reader (`packages/ledger-ui/src/http/reader.ts`) reads. A reader with no entry here has no
 * seeded key: `tests/seed-config.test.ts` fails when a reader that is not served by the Worker or the family service is
 * missing from this table or from its list of the readers that stay unavailable.
 */
export const readerConfig: Record<string, readonly ConfigName[]> = {
	settings: ["settings", "booking-rules"],
	schoolRules: ["booking-rules"],
	promos: ["promos"],
	planSummary: ["plans-draft"],
	disclosure: ["disclosure"],
};

const MAX_ATTEMPTS = 3;
/** The manifest's `updatedBy` for an object the seeder wrote. */
export const SEED_WRITER = "seed";

const settingsBySchool = settingsFixture.schools as unknown as Record<
	string,
	SchoolSettings
>;
const disclosureBySchool = disclosureFixture.schools as unknown as Record<
	string,
	{ override: ConfigValues["disclosure"]["override"] }
>;

/** The ids of the schools the UI's fixtures describe. */
export const fixtureSchoolIds = (): string[] => Object.keys(settingsBySchool);

/** A school to seed: its id in the bucket, and the fixture school whose values it gets (default: the same id). */
export type SeedTarget = string | { id: string; fixture: string };

const required = <Value>(value: Value | undefined, what: string): Value => {
	if (value === undefined) throw new Error(`no ${what} in the UI's fixtures`);
	return value;
};

const plansDraftOf = (fixture: string): PlansDraftConfig => {
	const plans = required(plansBySchool[fixture], `plans for ${fixture}`);
	const newest = plans.versions.versions[0];
	const menu =
		newest === undefined ? undefined : plans.bodies[newest.version]?.menu;
	const tiers = (menu?.tiers ?? []).map((tier) => ({
		id: tier.id,
		name: tier.name,
		blurb: tier.blurb,
		public: tier.public,
		...(tier.audience === undefined ? {} : { audience: tier.audience }),
	}));
	return {
		schemaVersion: SCHEMA_VERSION,
		draftVersion: newest?.publishedAt === null ? newest.version : null,
		features: plans.summary.features.map((feature) => ({
			id: feature.id,
			name: feature.name,
			unit: { one: feature.unit.one, other: feature.unit.other },
		})),
		tierOrder: tiers.map((tier) => tier.id),
		tiers,
		purchaseLinkShared: plans.summary.purchaseLinkShared,
	};
};

/** Every config object of one fixture school, as it would be seeded for the school `id`. */
export const fixtureObjects = (id: string, fixture: string): ConfigValues => {
	const settings = required(
		settingsBySchool[fixture],
		`settings for ${fixture}`,
	);
	const rules = required(rulesBySchool[fixture], `rules for ${fixture}`);
	const disclosure = required(
		disclosureBySchool[fixture],
		`disclosure for ${fixture}`,
	);
	const settingsConfig: SettingsConfig = {
		schemaVersion: SCHEMA_VERSION,
		school: id,
		basis: settings.basis,
		basisFrom: settings.basisFrom,
		stripe: settings.stripe,
		zeffy: settings.zeffy,
		keys: settings.keys,
	};
	return {
		settings: settingsConfig,
		disclosure: {
			schemaVersion: SCHEMA_VERSION,
			override: disclosure.override,
		},
		"booking-rules": { schemaVersion: SCHEMA_VERSION, ...rules },
		"plans-draft": plansDraftOf(fixture),
		promos: {
			schemaVersion: SCHEMA_VERSION,
			promos: (promosBySchool[fixture] ?? []).map((promo) => ({ ...promo })),
		},
	};
};

export type SeedAction = "written" | "unchanged" | "would-write" | "kept";
export type SeededObject = {
	school: string;
	name: ConfigName | "manifest";
	action: SeedAction;
	sha256: string;
};
export type SeedReport = {
	written: number;
	unchanged: number;
	/** Objects that differ from the fixture and were left alone (see `SeedOptions.overwrite`). */
	kept: number;
	/** Only a dry run: what a real run would write. */
	wouldWrite: number;
	objects: SeededObject[];
};

export type SeedOptions = {
	schools: readonly SeedTarget[];
	/** The instant the manifest records for what this run writes. */
	now: Date | string;
	/** Read only: report what would be written. */
	dryRun?: boolean;
	/** Replace an object whose bytes differ from the fixture's. Default: keep it (an owner may have edited it). */
	overwrite?: boolean;
};

const targetOf = (target: SeedTarget): { id: string; fixture: string } =>
	typeof target === "string" ? { id: target, fixture: target } : target;

const landObject = async (
	store: Store,
	key: string,
	text: string,
	sha256: string,
	dryRun: boolean,
	overwrite: boolean,
): Promise<SeedAction> => {
	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
		const current = await readStored(store, key);
		// equal bytes: either they were always there or a run at the same time put them
		if (current?.sha256 === sha256) return "unchanged";
		if (current && !overwrite) return "kept";
		if (dryRun) return "would-write";
		if (await putConditionally(store, key, text, expectationOf(current)))
			return "written";
	}
	throw new Error(`${key} kept changing while it was seeded`);
};

/**
 * Seeds the config objects of each school and rebuilds its manifest. Throws before writing anything for a school
 * whose fixture does not pass the Worker's own validators.
 */
export const seedSchoolFixtures = async (
	store: Store,
	options: SeedOptions,
): Promise<SeedReport> => {
	const now = new Date(options.now).toISOString();
	const dryRun = options.dryRun === true;
	const report: SeedReport = {
		written: 0,
		unchanged: 0,
		kept: 0,
		wouldWrite: 0,
		objects: [],
	};
	const count = (entry: SeededObject): void => {
		report.objects.push(entry);
		if (entry.action === "written") report.written += 1;
		else if (entry.action === "unchanged") report.unchanged += 1;
		else if (entry.action === "kept") report.kept += 1;
		else report.wouldWrite += 1;
	};
	for (const target of options.schools) {
		const { id, fixture } = targetOf(target);
		const objects = fixtureObjects(id, fixture);
		const prepared = await Promise.all(
			CONFIG_NAMES.map(async (name) => {
				const problems = definitions[name].validate(objects[name], id);
				if (problems.length > 0)
					throw new Error(
						`the ${fixture} fixture's ${name} is not valid: ${problems
							.map((problem) => `${problem.path} ${problem.message}`)
							.join("; ")}`,
					);
				const text = canonicalJson(objects[name]);
				return { name, text, sha256: await sha256Hex(bytesOf(text)) };
			}),
		);
		let anyWrite = false;
		for (const { name, text, sha256 } of prepared) {
			const action = await landObject(
				store,
				configKey(id, name),
				text,
				sha256,
				dryRun,
				options.overwrite === true,
			);
			if (action === "written" || action === "would-write") anyWrite = true;
			count({ school: id, name, action, sha256 });
		}
		const manifest = await updateManifest(store, id, {
			now,
			by: SEED_WRITER,
			dryRun,
		});
		count({
			school: id,
			name: "manifest",
			action: dryRun
				? manifest.changed || anyWrite
					? "would-write"
					: "unchanged"
				: manifest.wrote
					? "written"
					: "unchanged",
			sha256: manifest.sha256,
		});
	}
	return report;
};
