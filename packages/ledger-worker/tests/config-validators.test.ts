/** Canonical JSON, the hand-written validators, and their agreement with the UI's value lists. */
import { describe, expect, test } from "bun:test";
import {
	disclosureDelays as uiDelays,
	detailSteps as uiDetailSteps,
	disclosureGrains as uiGrains,
	kpiClasses as uiKpiClasses,
	ruledAudiences as uiRuledAudiences,
} from "../../ledger-ui/src/data/disclosure.ts";
import {
	stripePermissions,
	maxLiveKeysPerKind as uiMaxKeys,
} from "../../ledger-ui/src/data/settings.ts";
import { canonicalJson, sha256OfText } from "../src/config/canonical.js";
import { definitions } from "../src/config/definitions.js";
import { diffOf } from "../src/config/diff.js";
import type { ConfigName } from "../src/config/types.js";
import {
	detailSteps,
	disclosureDelays,
	disclosureGrains,
	kpiClasses,
	maxLiveKeysPerKind,
	moneyPermissions,
	ruledAudiences,
} from "../src/config/validate.js";
import { fixtureObjects } from "../src/testing/seed-config.js";

const paths = (name: ConfigName, value: unknown, school = "vol") =>
	definitions[name]
		.validate(value, school)
		.map((problem) => problem.path)
		.sort();

const fixture = (name: ConfigName) =>
	JSON.parse(JSON.stringify(fixtureObjects("vol", "vol")[name])) as Record<
		string,
		unknown
	>;

describe("canonical JSON", () => {
	test("sorts keys at every depth, indents by two spaces and ends with one newline", () => {
		expect(canonicalJson({ b: [1, { z: 1, a: [] }], a: {}, c: null })).toBe(
			`${JSON.stringify({ a: {}, b: [1, { a: [], z: 1 }], c: null }, null, 2)}\n`,
		);
	});

	test("equal content has equal bytes and an equal sha256, whatever the key order", async () => {
		const one = canonicalJson({ x: 1, y: { p: "é", q: [true, false] } });
		const other = canonicalJson({ y: { q: [true, false], p: "é" }, x: 1 });
		expect(one).toBe(other);
		expect(await sha256OfText(one)).toBe(await sha256OfText(other));
		expect(await sha256OfText("")).toBe(
			"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		);
	});

	test("a __proto__ key stays data and a number that is not finite is refused", () => {
		const parsed = JSON.parse('{"__proto__": {"x": 1}, "a": 1}') as unknown;
		expect(canonicalJson(parsed)).toContain('"__proto__": {');
		expect(() => canonicalJson({ a: Number.NaN })).toThrow("not finite");
		expect(() => canonicalJson({ a: undefined })).toThrow();
	});
});

describe("the diff", () => {
	test("lists each leaf that is added, removed or changed, by path", () => {
		expect(
			diffOf({ a: 1, b: [1, 2], c: { d: 1 } }, { a: 2, b: [1], c: { e: 1 } }),
		).toEqual([
			{ path: "a", change: "changed", before: 1, after: 2 },
			{ path: "b[1]", change: "removed", before: 2 },
			{ path: "c.d", change: "removed", before: 1 },
			{ path: "c.e", change: "added", after: 1 },
		]);
		expect(diffOf({ a: 1 }, { a: 1 })).toEqual([]);
		expect(diffOf(null, { a: 1 })).toEqual([
			{ path: "a", change: "added", after: 1 },
		]);
	});
});

describe("the validators agree with the UI", () => {
	test("the value lists equal the UI's", () => {
		expect(detailSteps).toEqual(uiDetailSteps as never);
		expect(disclosureGrains).toEqual(uiGrains as never);
		expect(disclosureDelays).toEqual(uiDelays as never);
		expect(kpiClasses).toEqual(uiKpiClasses as never);
		expect(ruledAudiences).toEqual(uiRuledAudiences as never);
		expect(moneyPermissions).toEqual(stripePermissions.money as never);
		expect(maxLiveKeysPerKind).toBe(uiMaxKeys);
	});
});

describe("settings", () => {
	test("every part is checked, and the school must be the path's", () => {
		const value = fixture("settings");
		expect(paths("settings", value, "other")).toEqual(["school"]);
		expect(
			paths("settings", {
				...value,
				basis: "accrual",
				basisFrom: "2026-02-30",
				stripe: {
					connected: true,
					account: "",
					mode: "test",
					last4: "abc",
					missing: ["Refunds (write)", "Invoices (write)"],
				},
				zeffy: { connected: false, last4: "1234" },
				keys: [
					{ id: "a", kind: "pk", label: "x", prefix: "p", used: "never" },
					{ id: "a", kind: "pk", label: "x", prefix: "p", used: "never" },
					{ id: "c", kind: "pk", label: "x", prefix: "p", used: "never" },
					{ id: "d", kind: "zz", label: "x", prefix: "p", used: "never" },
				],
			}),
		).toEqual([
			"basis",
			"basisFrom",
			"keys",
			"keys[1].id",
			"keys[3].kind",
			"stripe.account",
			"stripe.last4",
			"stripe.missing[1]",
			"stripe.mode",
			"zeffy.last4",
		]);
		expect(paths("settings", { ...value, extra: 1 })).toEqual(["extra"]);
		expect(paths("settings", [])).toEqual(["(value)"]);
		expect(paths("settings", { ...value, schemaVersion: 2 })).toEqual([
			"schemaVersion",
		]);
	});

	test("a control character or an over-long text is a problem", () => {
		const value = fixture("settings");
		expect(
			paths("settings", {
				...value,
				keys: [
					{
						id: "a",
						kind: "pk",
						label: "a\nb",
						prefix: "p",
						used: "x".repeat(41),
					},
				],
			}),
		).toEqual(["keys[0].label", "keys[0].used"]);
	});
});

describe("disclosure", () => {
	test("moves, rules and rounding are checked against the file's vocabulary", () => {
		expect(paths("disclosure", fixture("disclosure"))).toEqual([]);
		const override = {
			moves: { cost_per_member: "income", bad: "elsewhere" },
			rules: {
				"income.public": {
					detail: "breakdown",
					every: "month",
					after: "3 months",
				},
				"personal.public": { detail: "total", every: "year" },
				"cash.member": null,
				"losses.governance": {
					detail: "names",
					every: "week",
					after: "1 day",
					extra: 1,
				},
			},
			rounding: { small: { public: -1, member: 100 }, huge: {} },
		};
		expect(paths("disclosure", { schemaVersion: 1, override })).toEqual([
			"override.moves.bad",
			"override.rounding.huge",
			"override.rounding.small.public",
			"override.rules.losses.governance.after",
			"override.rules.losses.governance.every",
			"override.rules.losses.governance.extra",
			"override.rules.personal.public",
		]);
		expect(
			paths("disclosure", {
				schemaVersion: 1,
				override: { moves: [], rules: 3 },
			}),
		).toEqual(["override.moves", "override.rules"]);
	});
});

describe("booking rules", () => {
	test("a whole cutoff in range and the two policies", () => {
		const value = fixture("booking-rules");
		expect(paths("booking-rules", value)).toEqual([]);
		expect(
			paths("booking-rules", {
				...value,
				cancelCutoffHours: 24.5,
				noShow: "x",
			}),
		).toEqual(["cancelCutoffHours", "noShow"]);
		expect(
			paths("booking-rules", { ...value, cancelCutoffHours: 721 }),
		).toEqual(["cancelCutoffHours"]);
		expect(paths("booking-rules", { ...value, cancelCutoffHours: 0 })).toEqual(
			[],
		);
	});
});

describe("plans draft", () => {
	test("tier order must list every tier once", () => {
		const value = fixture("plans-draft") as {
			tierOrder: string[];
			tiers: { id: string }[];
		};
		expect(paths("plans-draft", value)).toEqual([]);
		expect(
			paths("plans-draft", {
				...value,
				tierOrder: [...value.tierOrder].slice(1),
			}),
		).toEqual(["tierOrder"]);
		expect(
			paths("plans-draft", {
				...value,
				tierOrder: [...value.tierOrder.slice(1), "ghost"],
			}),
		).toEqual([`tierOrder[${value.tierOrder.length - 1}]`]);
		expect(
			paths("plans-draft", {
				...value,
				tierOrder: [
					value.tierOrder[0],
					value.tierOrder[0],
					...value.tierOrder.slice(2),
				],
			}),
		).toContain("tierOrder[1]");
		expect(
			paths("plans-draft", {
				...value,
				draftVersion: 0,
				purchaseLinkShared: "yes",
			}),
		).toEqual(["draftVersion", "purchaseLinkShared"]);
		expect(
			paths("plans-draft", {
				...value,
				features: [{ id: "a", name: "A", unit: { one: "a" } }],
			}),
		).toEqual(["features[0].unit.other"]);
	});

	test("a price or a count is not a field of the draft", () => {
		const value = fixture("plans-draft") as {
			tiers: Record<string, unknown>[];
		};
		const tiers = value.tiers.map((tier) => ({
			...tier,
			prices: [{ interval: "month", amount: 1 }],
		}));
		expect(paths("plans-draft", { ...value, tiers })).toContain(
			"tiers[0].prices",
		);
	});
});

describe("promos", () => {
	const promo = {
		id: "p1",
		code: "SPRING10",
		type: "member",
		value: 10,
		used: 0,
		maxUses: null,
		expiresOn: "2026-12-31",
		status: "active",
	};

	test("each field by type, ids and codes once, used within maxUses", () => {
		expect(paths("promos", fixture("promos"))).toEqual([]);
		expect(paths("promos", { schemaVersion: 1, promos: [promo] })).toEqual([]);
		expect(
			paths("promos", {
				schemaVersion: 1,
				promos: [
					promo,
					{ ...promo, code: "spring10", value: 101 },
					{
						...promo,
						id: "p3",
						code: "a",
						type: "gift",
						status: "gone",
						expiresOn: "soon",
					},
					{
						...promo,
						id: "p4",
						code: "TWO",
						type: "dollar",
						value: 0,
						used: 3,
						maxUses: 2,
					},
				],
			}),
		).toEqual([
			"promos[1].code",
			"promos[1].id",
			"promos[1].value",
			"promos[2].code",
			"promos[2].expiresOn",
			"promos[2].status",
			"promos[2].type",
			"promos[3].used",
			"promos[3].value",
		]);
	});

	test("only the promos are money-bearing", () => {
		expect(
			Object.entries(definitions)
				.filter(([, definition]) => definition.moneyBearing)
				.map(([name]) => name),
		).toEqual(["promos"]);
	});
});
