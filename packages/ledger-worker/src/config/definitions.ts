/** What each config object is: its validator and whether it is money-bearing (the finance grant reads it). */

import type { ConfigName } from "./types.js";
import {
	booleanAt,
	type Collector,
	choiceAt,
	dayAt,
	detailSteps,
	disclosureDelays,
	disclosureGrains,
	identifierAt,
	integerAt,
	isRecord,
	kpiClasses,
	limits,
	listAt,
	maxLiveKeysPerKind,
	moneyPermissions,
	objectAt,
	problemsOf,
	requireVersion,
	ruledAudiences,
	ruledClasses,
	textAt,
	uniqueIn,
	type Validator,
} from "./validate.js";

const ACCOUNTING_BASES = ["cash", "deferred"] as const;
const KEY_KINDS = ["pk", "sk", "rd"] as const;
const SPEND_OR_RELEASE = ["spend", "release"] as const;
const PROMO_TYPES = ["member", "dollar", "session"] as const;
const PROMO_STATUSES = ["active", "disabled", "redeemed"] as const;
const TIER_AUDIENCES = ["member", "governance", "public"] as const;
const LAST_FOUR = 4;
const KEY_PREFIX_LENGTH = 15;
const MAX_LABEL = 80;
const MAX_USED = 40;
const MAX_BLURB = 200;
const MAX_VERSION = 1_000_000;
const MAX_COUNT = 1_000_000_000;

const stripeFields = ["connected", "account", "mode", "last4", "missing"];
const settingsStripe = (collector: Collector, value: unknown): void => {
	const stripe = objectAt(collector, value, "stripe", stripeFields);
	if (stripe === null) return;
	if (stripe.connected === false) {
		for (const key of Object.keys(stripe))
			if (key !== "connected")
				collector.add(
					`stripe.${key}`,
					"is not allowed when Stripe is not connected",
					"Remove it.",
				);
		return;
	}
	if (stripe.connected !== true) {
		collector.add(
			"stripe.connected",
			"must be true or false",
			"Use true or false.",
		);
		return;
	}
	textAt(collector, stripe, "stripe", "account");
	if (stripe.mode !== "live")
		collector.add("stripe.mode", "must be live", "Only a live key is kept.");
	const last4 = textAt(collector, stripe, "stripe", "last4", {
		max: LAST_FOUR,
	});
	if (last4 !== null && last4.length !== LAST_FOUR)
		collector.add(
			"stripe.last4",
			"must be 4 characters",
			"Give the key's last four characters.",
		);
	const missing = listAt(
		collector,
		stripe,
		"stripe",
		"missing",
		moneyPermissions.length,
	);
	if (missing === null) return;
	let lastIndex = -1;
	for (const [index, permission] of missing.entries()) {
		const at = (moneyPermissions as readonly unknown[]).indexOf(permission);
		if (at < 0 || at <= lastIndex)
			collector.add(
				`stripe.missing[${index}]`,
				`must be one of ${moneyPermissions.join(", ")}, each once, in that order`,
				"List only the money permissions the key lacks.",
			);
		lastIndex = Math.max(lastIndex, at);
	}
};

const settingsZeffy = (collector: Collector, value: unknown): void => {
	const zeffy = objectAt(collector, value, "zeffy", ["connected", "last4"]);
	if (zeffy === null) return;
	if (zeffy.connected === false) {
		if (Object.keys(zeffy).length > 1)
			collector.add(
				"zeffy.last4",
				"is not allowed when Zeffy is not connected",
				"Remove it.",
			);
		return;
	}
	if (zeffy.connected !== true) {
		collector.add(
			"zeffy.connected",
			"must be true or false",
			"Use true or false.",
		);
		return;
	}
	const last4 = textAt(collector, zeffy, "zeffy", "last4", { max: LAST_FOUR });
	if (last4 !== null && last4.length !== LAST_FOUR)
		collector.add(
			"zeffy.last4",
			"must be 4 characters",
			"Give the key's last four characters.",
		);
};

const settingsKeys = (
	collector: Collector,
	record: Record<string, unknown>,
): void => {
	const keys = listAt(collector, record, "", "keys");
	if (keys === null) return;
	const ids = new Set<string>();
	const live = { pk: 0, sk: 0 };
	for (const [index, entry] of keys.entries()) {
		const path = `keys[${index}]`;
		const key = objectAt(collector, entry, path, [
			"id",
			"kind",
			"label",
			"prefix",
			"used",
		]);
		if (key === null) continue;
		uniqueIn(
			collector,
			ids,
			identifierAt(collector, key, path, "id"),
			`${path}.id`,
		);
		const kind = choiceAt(collector, key, path, "kind", KEY_KINDS);
		textAt(collector, key, path, "label", { max: MAX_LABEL });
		textAt(collector, key, path, "prefix", { max: KEY_PREFIX_LENGTH });
		textAt(collector, key, path, "used", { max: MAX_USED });
		if (kind === "pk" || kind === "sk") live[kind] += 1;
	}
	for (const kind of ["pk", "sk"] as const)
		if (live[kind] > maxLiveKeysPerKind)
			collector.add(
				"keys",
				`has more than ${maxLiveKeysPerKind} live ${kind} keys`,
				"Revoke a key before adding another.",
			);
};

const validateSettings: Validator = (value, school) =>
	problemsOf((collector) => {
		const record = objectAt(collector, value, "", [
			"schemaVersion",
			"school",
			"basis",
			"basisFrom",
			"stripe",
			"zeffy",
			"keys",
		]);
		if (record === null) return;
		requireVersion(collector, record);
		if (record.school !== school)
			collector.add(
				"school",
				`must be ${school}`,
				"A school's settings name the school they belong to.",
			);
		choiceAt(collector, record, "", "basis", ACCOUNTING_BASES);
		dayAt(collector, record, "", "basisFrom");
		settingsStripe(collector, record.stripe);
		settingsZeffy(collector, record.zeffy);
		settingsKeys(collector, record);
	});

const disclosureRule = (
	collector: Collector,
	value: unknown,
	path: string,
): void => {
	const rule = objectAt(collector, value, path, ["detail", "every", "after"]);
	if (rule === null) return;
	choiceAt(collector, rule, path, "detail", detailSteps);
	choiceAt(collector, rule, path, "every", disclosureGrains);
	if (Object.hasOwn(rule, "after"))
		choiceAt(collector, rule, path, "after", disclosureDelays);
};

const ruleKeys: string[] = ruledClasses.flatMap((ruleClass) =>
	ruledAudiences.map((audience) => `${ruleClass}.${audience}`),
);

const disclosureRounding = (collector: Collector, value: unknown): void => {
	const rounding = objectAt(collector, value, "override.rounding", [
		"small",
		"large",
	]);
	if (rounding === null) return;
	for (const size of ["small", "large"] as const) {
		if (!Object.hasOwn(rounding, size)) continue;
		const path = `override.rounding.${size}`;
		const units = objectAt(collector, rounding[size], path, [
			"public",
			"member",
		]);
		if (units === null) continue;
		for (const audience of ["public", "member"] as const)
			if (Object.hasOwn(units, audience))
				integerAt(collector, units, path, audience, {
					min: 0,
					max: limits.MAX_ROUNDING_UNIT,
				});
	}
};

const validateDisclosure: Validator = (value) =>
	problemsOf((collector) => {
		const record = objectAt(collector, value, "", [
			"schemaVersion",
			"override",
		]);
		if (record === null) return;
		requireVersion(collector, record);
		const override = objectAt(collector, record.override, "override", [
			"moves",
			"rules",
			"rounding",
		]);
		if (override === null) return;
		if (Object.hasOwn(override, "moves")) {
			const moves = isRecord(override.moves) ? override.moves : null;
			if (moves === null)
				collector.add(
					"override.moves",
					"must be an object",
					"Map each KPI id to a class.",
				);
			else
				for (const [kpi, target] of Object.entries(moves))
					if (kpi === "" || kpi.length > MAX_LABEL)
						collector.add(
							`override.moves.${kpi}`,
							"is not a KPI id",
							"Use the KPI's id.",
						);
					else if (!(kpiClasses as readonly unknown[]).includes(target))
						collector.add(
							`override.moves.${kpi}`,
							`must be one of ${kpiClasses.join(", ")}`,
							"Pick a KPI class.",
						);
		}
		if (Object.hasOwn(override, "rules")) {
			const rules = isRecord(override.rules) ? override.rules : null;
			if (rules === null)
				collector.add(
					"override.rules",
					"must be an object",
					"Key each rule by class.audience.",
				);
			else
				for (const [key, rule] of Object.entries(rules)) {
					const path = `override.rules.${key}`;
					if (!ruleKeys.includes(key))
						collector.add(
							path,
							"is not a class and audience that have a rule",
							"Use a key like income.public.",
						);
					else if (rule !== null) disclosureRule(collector, rule, path);
				}
		}
		if (Object.hasOwn(override, "rounding"))
			disclosureRounding(collector, override.rounding);
	});

const validateBookingRules: Validator = (value) =>
	problemsOf((collector) => {
		const record = objectAt(collector, value, "", [
			"schemaVersion",
			"cancelCutoffHours",
			"noShow",
			"lateCancel",
		]);
		if (record === null) return;
		requireVersion(collector, record);
		integerAt(collector, record, "", "cancelCutoffHours", {
			min: 0,
			max: limits.MAX_CUTOFF_HOURS,
		});
		choiceAt(collector, record, "", "noShow", SPEND_OR_RELEASE);
		choiceAt(collector, record, "", "lateCancel", SPEND_OR_RELEASE);
	});

const planFeatures = (
	collector: Collector,
	record: Record<string, unknown>,
): void => {
	const features = listAt(collector, record, "", "features");
	if (features === null) return;
	const ids = new Set<string>();
	for (const [index, entry] of features.entries()) {
		const path = `features[${index}]`;
		const feature = objectAt(collector, entry, path, ["id", "name", "unit"]);
		if (feature === null) continue;
		uniqueIn(
			collector,
			ids,
			identifierAt(collector, feature, path, "id"),
			`${path}.id`,
		);
		textAt(collector, feature, path, "name", { max: MAX_LABEL });
		const unit = objectAt(collector, feature.unit, `${path}.unit`, [
			"one",
			"other",
		]);
		if (unit === null) continue;
		textAt(collector, unit, `${path}.unit`, "one", { max: MAX_LABEL });
		textAt(collector, unit, `${path}.unit`, "other", { max: MAX_LABEL });
	}
};

const planTiers = (
	collector: Collector,
	record: Record<string, unknown>,
): string[] => {
	const tiers = listAt(collector, record, "", "tiers");
	const ids: string[] = [];
	if (tiers === null) return ids;
	const seen = new Set<string>();
	for (const [index, entry] of tiers.entries()) {
		const path = `tiers[${index}]`;
		const tier = objectAt(collector, entry, path, [
			"id",
			"name",
			"blurb",
			"public",
			"audience",
		]);
		if (tier === null) continue;
		const id = identifierAt(collector, tier, path, "id");
		uniqueIn(collector, seen, id, `${path}.id`);
		if (id !== null) ids.push(id);
		textAt(collector, tier, path, "name", { max: MAX_LABEL });
		textAt(collector, tier, path, "blurb", {
			max: MAX_BLURB,
			allowEmpty: true,
		});
		booleanAt(collector, tier, path, "public");
		if (Object.hasOwn(tier, "audience"))
			choiceAt(collector, tier, path, "audience", TIER_AUDIENCES);
	}
	return ids;
};

const validatePlansDraft: Validator = (value) =>
	problemsOf((collector) => {
		const record = objectAt(collector, value, "", [
			"schemaVersion",
			"draftVersion",
			"features",
			"tierOrder",
			"tiers",
			"purchaseLinkShared",
		]);
		if (record === null) return;
		requireVersion(collector, record);
		if (record.draftVersion !== null)
			integerAt(collector, record, "", "draftVersion", {
				min: 1,
				max: MAX_VERSION,
			});
		planFeatures(collector, record);
		const tierIds = planTiers(collector, record);
		const order = listAt(collector, record, "", "tierOrder");
		if (order !== null) {
			const seen = new Set<string>();
			for (const [index, id] of order.entries()) {
				if (typeof id !== "string" || !tierIds.includes(id))
					collector.add(
						`tierOrder[${index}]`,
						"is not the id of a tier",
						"List the ids of the tiers below.",
					);
				else uniqueIn(collector, seen, id, `tierOrder[${index}]`);
			}
			if (order.length !== tierIds.length)
				collector.add(
					"tierOrder",
					"must list every tier once",
					"Add the missing tiers or remove the extra ids.",
				);
		}
		booleanAt(collector, record, "", "purchaseLinkShared");
	});

const validatePromos: Validator = (value) =>
	problemsOf((collector) => {
		const record = objectAt(collector, value, "", ["schemaVersion", "promos"]);
		if (record === null) return;
		requireVersion(collector, record);
		const promos = listAt(collector, record, "", "promos");
		if (promos === null) return;
		const ids = new Set<string>();
		const codes = new Set<string>();
		for (const [index, entry] of promos.entries()) {
			const path = `promos[${index}]`;
			const promo = objectAt(collector, entry, path, [
				"id",
				"code",
				"type",
				"value",
				"used",
				"maxUses",
				"expiresOn",
				"status",
			]);
			if (promo === null) continue;
			uniqueIn(
				collector,
				ids,
				identifierAt(collector, promo, path, "id"),
				`${path}.id`,
			);
			const code =
				typeof promo.code === "string" && limits.PROMO_CODE.test(promo.code)
					? promo.code
					: null;
			if (code === null)
				collector.add(
					`${path}.code`,
					"must be 3 to 40 letters, digits or dashes",
					"Use letters, digits and -.",
				);
			uniqueIn(collector, codes, code?.toUpperCase() ?? null, `${path}.code`);
			const type = choiceAt(collector, promo, path, "type", PROMO_TYPES);
			const maximum =
				type === "member"
					? limits.MAX_PERCENT
					: type === "dollar"
						? limits.MAX_DOLLAR_PROMO
						: limits.MAX_SESSION_PROMO;
			integerAt(collector, promo, path, "value", { min: 1, max: maximum });
			const used = integerAt(collector, promo, path, "used", {
				min: 0,
				max: MAX_COUNT,
			});
			if (promo.maxUses !== null) {
				const maxUses = integerAt(collector, promo, path, "maxUses", {
					min: 1,
					max: MAX_COUNT,
				});
				if (used !== null && maxUses !== null && used > maxUses)
					collector.add(
						`${path}.used`,
						"is more than maxUses",
						"Raise maxUses or lower used.",
					);
			}
			dayAt(collector, promo, path, "expiresOn");
			choiceAt(collector, promo, path, "status", PROMO_STATUSES);
		}
	});

export type ConfigDefinition = {
	validate: Validator;
	/** The finance grant is needed to read it. */
	moneyBearing: boolean;
};

export const definitions: Record<ConfigName, ConfigDefinition> = {
	settings: { validate: validateSettings, moneyBearing: false },
	disclosure: { validate: validateDisclosure, moneyBearing: false },
	"booking-rules": { validate: validateBookingRules, moneyBearing: false },
	"plans-draft": { validate: validatePlansDraft, moneyBearing: false },
	promos: { validate: validatePromos, moneyBearing: true },
};
