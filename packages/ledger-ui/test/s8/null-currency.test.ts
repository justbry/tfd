import { afterEach, expect, test } from "bun:test";
import type { Reader } from "../../src/data/reader.ts";
import { createFixtureReader } from "../../src/fixtures/reader.ts";
import {
	cleanUp,
	click,
	clock,
	count,
	element,
	fill,
	open,
	text,
} from "../s5/helpers.ts";

/**
 * A school with no currency (S8-contract section 11: no published menu and no Stripe account, so buzz-school's
 * `ledger/school` answers `currency: null`). Found on staging: one such school made the whole `schools()` answer
 * reject, so the app could not mount. It mounts, the switcher lists it, and its money reads "—", never `$0.00` and
 * never a currency made up.
 */
afterEach(cleanUp);

const base = createFixtureReader({ clock });
const noCurrencySchool = "vol";
const reader: Reader = {
	...base,
	schools: async () =>
		(await base.schools()).map((school) =>
			school.id === noCurrencySchool ? { ...school, currency: null } : school,
		),
	/* No currency is no menu: the school has never published plans. */
	menuVersions: async (school) =>
		school === noCurrencySchool
			? { ...(await base.menuVersions(school)), versions: [] }
			: base.menuVersions(school),
};

test("a school with no currency mounts, and the switcher lists it", async () => {
	await open(`#/${noCurrencySchool}/dashboard`, { reader });
	expect(count("[data-test=pane]")).toBe(1);
	await click("[data-test=school-switcher]");
	const listed = [...document.querySelectorAll("[data-test=school-option]")]
		.map((option) => option.getAttribute("data-school"))
		.filter((school) => school !== "all");
	expect(listed).toEqual((await base.schools()).map(({ id }) => id));
});

test("its Dashboard writes money in the KPI document's own currency, never the school's null", async () => {
	await open(`#/${noCurrencySchool}/dashboard`, { reader });
	const shown = text("[data-test=pane]");
	expect(shown).toContain("$287.00");
	expect(shown).not.toContain("null");
	expect(shown).not.toContain("NaN");
});

test("its Plans show — for every price, never $0.00 or a made-up currency", async () => {
	await open(`#/${noCurrencySchool}/plans?mode=code&theme=light`);
	const published = element<HTMLTextAreaElement>("[data-test=plan-yaml]").value;
	cleanUp();
	await open(`#/${noCurrencySchool}/plans?mode=code&theme=light`, { reader });
	const empty = element<HTMLTextAreaElement>("[data-test=plan-yaml]").value;
	expect(empty).toContain('currency: ""');
	/* The same plans as a draft of the school's first menu, which has no currency either. */
	await fill(
		"[data-test=plan-yaml]",
		published
			.replace("currency: USD", 'currency: ""')
			.replace(/^version: \d+$/m, "version: 0"),
	);
	await click("[data-test=plan-mode][data-mode=edit]");
	const shown = text("[data-test=pane]");
	expect(shown).toContain("— per session / month · — / year");
	expect(shown).toContain("— one time");
	expect(shown).not.toContain("$");
});

test("its Reports document figures read — rather than $0.00", async () => {
	const figures = (): string[] =>
		[
			...document.querySelectorAll(
				"[data-test=report-kpi-value], [data-test=report-line-amount]",
			),
		].map((figure) => figure.textContent ?? "");
	await open(`#/${noCurrencySchool}/reports?as=governance&period=2026-09`);
	const withCurrency = figures();
	expect(withCurrency.some((figure) => figure.includes("$"))).toBe(true);
	cleanUp();
	await open(`#/${noCurrencySchool}/reports?as=governance&period=2026-09`, {
		reader,
	});
	const withoutCurrency = figures();
	expect(withoutCurrency.length).toBe(withCurrency.length);
	for (const figure of withoutCurrency) expect(figure).not.toContain("$");
	expect(withoutCurrency).toContain("—");
});
