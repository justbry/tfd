import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	audienceNames as contractAudienceNames,
	viewAsValues,
} from "$contract/data/disclosure.ts";
import { createFixtureReader } from "$contract/fixtures/reader.ts";
import * as settingsModel from "../../src/app/settings/settings-model.ts";
import * as viewAs from "../../src/app/view-as.ts";
import { calendar } from "../helpers.ts";

/** Consistency check C for the member portal and Settings. Three modules of the Svelte app copy what the Preact package keeps
 * inside components that import Preact (so they cannot be imported here), or inside the contract module whose size the
 * first page load must not carry:
 *  - src/app/view-as.ts: `resolveViewAs` and `audienceNames` of the contract (`data/disclosure.ts`); run here against it on
 *    every school and every `as=`.
 *  - src/app/portal/portal-model.ts: the constants of the Preact portal.tsx and portal-views.tsx (the tabs, the route's
 *    parameters, the School books card's words, the family roles); their source is compared with the copy's, normalised
 *    (whitespace, trailing commas and type annotations; each difference is listed in `intentional`), and the exported
 *    functions it exports and the helpers of the views are the same code (their source, compared the same way).
 *  - src/app/settings/settings-model.ts: the constants of the Preact settings.tsx and settings-books.tsx (key texts,
 *    the disclosure editor's choices, the change table and notes), compared the same way.
 * The Preact modules are read as text: they import Preact and JSX, which this package neither resolves nor type-checks. The
 * plan, the counts and the history CSV come from the Preact portal-format.ts, which imports no Preact and is imported
 * as it is. */
const preactApp = join(import.meta.dir, "../../../ledger-ui/src/app");
const source = (name: string): string =>
	readFileSync(join(preactApp, name), "utf8");
const portalSources = [source("portal.tsx"), source("portal-views.tsx")].join(
	"\n",
);
const settingsSources = [
	source("settings.tsx"),
	source("settings-books.tsx"),
].join("\n");

/** The value a `const NAME[: Type] = <value>;` declaration holds, up to its closing `;` outside strings and brackets. */
function declaredValue(text: string, name: string): string {
	const found = new RegExp(
		`(?:^|\\n)\\s*(?:export\\s+)?const\\s+${name}\\b`,
	).exec(text);
	if (!found) throw new Error(`no const ${name}`);
	let index = text.indexOf("=", found.index + found[0].length);
	// A type annotation can hold `=>`: the declaration's `=` is the first one outside `<>` and `()`.
	let angle = 0;
	let paren = 0;
	for (let at = found.index + found[0].length; at < text.length; at += 1) {
		const character = text[at];
		if (character === "<") angle += 1;
		else if (character === ">" && text[at - 1] !== "=") angle -= 1;
		else if (character === "(") paren += 1;
		else if (character === ")") paren -= 1;
		else if (
			character === "=" &&
			text[at + 1] !== ">" &&
			angle <= 0 &&
			paren <= 0
		) {
			index = at;
			break;
		}
	}
	let depth = 0;
	let quote = "";
	let end = index + 1;
	for (; end < text.length; end += 1) {
		const character = text[end];
		if (character === "\\") {
			end += 1;
			continue;
		}
		if (quote) {
			if (character === quote) quote = "";
			continue;
		}
		if (character === '"' || character === "'" || character === "`")
			quote = character;
		else if ("([{".includes(character ?? "")) depth += 1;
		else if (")]}".includes(character ?? "")) depth -= 1;
		else if (character === ";" && depth === 0) break;
	}
	return text.slice(index + 1, end);
}
const normalised = (value: string): string =>
	value
		.replace(/\s+/g, "")
		.replace(/,([\]})])/g, "$1")
		.replace(/\/\*[\s\S]*?\*\//g, "");

/** The constants of the copies and the Preact names they come from (`as` where the name differs). */
const portalConstants: Array<[string, string]> = [
	["booksCopy", "booksCopy"],
	["booksActions", "booksActions"],
	["portalParameters", "portalParameters"],
	["defaultTab", "defaultTab"],
	["defaultTheme", "defaultTheme"],
	["defaultPeriod", "defaultPeriod"],
	["tabs", "tabs"],
	["previewTitle", "previewTitle"],
];
const settingsConstants = [
	"keyNames",
	"keyHints",
	"keyBadges",
	"keyIcons",
	"keyMenuLabels",
	"keyKinds",
	"copyFailedToast",
	"disclosureSavedToast",
	"detailChoices",
	"everyChoices",
	"afterChoices",
	"roundChoices",
	"ruleClasses",
	"changeTable",
	"changeNotes",
];
/** What differs on purpose, per constant: nothing today (the declaration's `export` and type annotation are outside the
 * compared value; an entry here would rewrite the copy's value before the comparison, and say why). */
const intentional: Record<string, (value: string) => string> = {};

describe("src/app/view-as.ts answers as the contract's disclosure module does", () => {
	test("audienceNames is the contract's table", () => {
		expect(viewAs.audienceNames).toEqual(contractAudienceNames);
	});
	test("resolveViewAs picks the same row and preview on every school and every as=", async () => {
		const reader = createFixtureReader({ clock: calendar });
		const contract = await import("$contract/data/disclosure.ts");
		const schools = await reader.schools();
		expect(schools.length).toBeGreaterThan(3);
		for (const school of schools) {
			const disclosure = await reader.disclosure(school.id);
			for (const asked of [null, "", "nobody", ...viewAsValues])
				expect(viewAs.resolveViewAs(asked, disclosure)).toEqual(
					contract.resolveViewAs(asked, disclosure),
				);
		}
	});
});

describe("src/app/portal/portal-model.ts keeps the Preact portal's constants", () => {
	for (const [name, preactName] of portalConstants)
		test(`${name}`, () => {
			const mine = declaredValue(
				readFileSync(
					join(import.meta.dir, "../../src/app/portal/portal-model.ts"),
					"utf8",
				),
				name,
			);
			const theirs = declaredValue(portalSources, preactName);
			expect(normalised((intentional[name] ?? ((value) => value))(mine))).toBe(
				normalised(theirs),
			);
		});
	for (const name of [
		"publishedPeriod",
		"bookingsOf",
		"familyRoleLabel",
		"roleLabels",
		"dayText",
		"dayMonthYear",
		"hostNames",
		"whenOf",
	])
		test(`${name} is the same code`, () => {
			const mine = declaredValue(
				readFileSync(
					join(import.meta.dir, "../../src/app/portal/portal-model.ts"),
					"utf8",
				),
				name,
			);
			expect(normalised(mine)).toBe(
				normalised(declaredValue(portalSources, name)),
			);
		});
});

describe("src/app/settings/settings-model.ts keeps the Preact Settings' constants", () => {
	for (const name of settingsConstants)
		test(`${name}`, () => {
			const mine = declaredValue(
				readFileSync(
					join(import.meta.dir, "../../src/app/settings/settings-model.ts"),
					"utf8",
				),
				name,
			);
			const theirs = declaredValue(settingsSources, name);
			expect(normalised((intentional[name] ?? ((value) => value))(mine))).toBe(
				normalised(theirs),
			);
		});
	test("the settings seeds hold what the Reader's settings hold, field for field", async () => {
		const reader = createFixtureReader({ clock: calendar });
		for (const school of await reader.schools()) {
			const settings = await reader.settings(school.id);
			const seed = settingsModel.settingsSeed(settings);
			expect(seed).toEqual({
				schemaVersion: 1,
				school: school.id,
				basis: settings.basis,
				basisFrom: settings.basisFrom,
				stripe: settings.stripe,
				zeffy: settings.zeffy,
				keys: settings.keys,
			});
			expect(settingsModel.rulesSeed(settings)).toEqual({
				schemaVersion: 1,
				...settings.bookingRules,
			});
		}
	});
});
