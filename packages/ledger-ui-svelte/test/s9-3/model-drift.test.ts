import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { monthOfPeriod, type Period } from "$contract/app/period.ts";
import { viewedMonthOf } from "../../src/app/plans/overview-model.ts";
import { diffMenus } from "../../src/app/plans/plans-menu.ts";

/** The pure Plans logic is the Preact package's, copied because the Preact files sit beside Preact UI types (hygiene
 * allows only the contract): these tests fail when a copy and its original differ in anything but their imports. */
const here = join(import.meta.dir, "../..");
const original = (file: string): string =>
	readFileSync(join(here, "../ledger-ui/src/app", file), "utf8");
const copy = (file: string): string =>
	readFileSync(join(here, "src/app/plans", file), "utf8");
/** The file without its leading comment and its import statements. */
const body = (text: string): string =>
	text
		.replace(/^\/\*\*[\s\S]*?\*\/\n/, "")
		.replace(/^import[\s\S]*?from "[^"]+";\n/gm, "")
		.trim();

/** The one place a copy differs from its original on purpose (a review finding the Preact package, read-only here, has
 * not fixed): a tier with no monthly price is "none" in the review and the Code view's changes, as its yearly price is,
 * never `$0.00` (the table shows a dash: null is never 0). The test applies the patch to the original, so that it fails
 * both when the copy drifts and when the original no longer has the text to patch. */
const deviations: Array<[string, string]> = [
	[
		`	const liveMonth = monthlyAmount(live) ?? 0;
	const draftMonth = monthlyAmount(draft) ?? 0;
	if (draftMonth !== liveMonth)
		lines.push({
			title: \`Monthly price \${formatMoney(liveMonth, currency)} → \${formatMoney(draftMonth, currency)}\`,
			detail: \`Create a \${formatMoney(draftMonth, currency)}/month price and archive the \${formatMoney(liveMonth, currency)} one\`,
		});`,
		`	const liveMonth = monthlyAmount(live);
	const draftMonth = monthlyAmount(draft);
	if ((draftMonth ?? 0) !== (liveMonth ?? 0))
		lines.push({
			title: \`Monthly price \${liveMonth ? formatMoney(liveMonth, currency) : "none"} → \${draftMonth ? formatMoney(draftMonth, currency) : "none"}\`,
			detail: draftMonth
				? \`Create a \${formatMoney(draftMonth, currency)}/month price\${liveMonth ? \` and archive the \${formatMoney(liveMonth, currency)} one\` : ""}\`
				: "Archive the monthly price",
		});`,
	],
];
const patched = (text: string): string =>
	deviations.reduce((patchedText, [from, to]) => {
		expect(patchedText).toContain(from);
		return patchedText.replace(from, () => to);
	}, text);

describe("the copies of the Preact package's Plans logic", () => {
	test("plans-menu.ts has the original's body, but for the documented deviation", () => {
		expect(body(copy("plans-menu.ts"))).toBe(
			body(patched(original("plans-menu.ts"))),
		);
	});
	test("plans-yaml.ts has the original's body", () => {
		expect(body(copy("plans-yaml.ts"))).toBe(body(original("plans-yaml.ts")));
	});
	test("the copies import only the contract's data, the money and the viewing of this package", () => {
		for (const file of ["plans-menu.ts", "plans-yaml.ts"]) {
			const specifiers = [...copy(file).matchAll(/from "([^"]+)"/g)].map(
				([, specifier]) => specifier,
			);
			for (const specifier of specifiers)
				expect(
					/^\$contract\/data\/|^\.\.\/(money|viewing)\.ts$/.test(
						specifier ?? "",
					),
				).toBe(true);
		}
	});
});

describe("viewedMonthOf is the contract's monthOfPeriod", () => {
	const periods: Period[] = [
		{ from: "2026-11-01", to: "2026-11-30" },
		{ from: "2026-10-01", to: "2026-10-31" },
		{ from: "2026-01-01", to: "2026-12-31" },
		{ from: "2026-07-01", to: "2026-09-30" },
		{ from: "2025-01-01", to: "2025-12-31" },
		{ from: "2026-02-01", to: "2026-02-28" },
		{ from: "2024-02-01", to: "2024-02-29" },
		{ from: "2026-11-03", to: "2026-11-12" },
		{ from: "2026-09-01", to: "2026-11-30" },
		{ from: "2026-03-05", to: "2026-12-31" },
		{ from: "2026-01-01", to: "2026-06-30" },
		{ from: "2026-12-01", to: "2026-12-31" },
	];
	for (const today of ["2026-11-05", "2026-01-31", "2027-02-01"])
		test(`for the clock at ${today}`, () => {
			for (const period of periods)
				expect({ period, month: viewedMonthOf(period, today) }).toEqual({
					period,
					month: monthOfPeriod(period, today),
				});
		});
});

describe("a tier with no monthly price is none, never $0.00", () => {
	const menu = (
		prices: Array<{ interval: "month" | "year"; amount: number }>,
	) => ({
		currency: "usd",
		timeZone: "America/Denver",
		features: [],
		tiers: [
			{
				id: "board",
				name: "Board",
				blurb: "",
				public: false,
				prices,
				grants: [],
			},
		],
		addons: [],
	});
	test("a price added, removed and changed reads as the table does", () => {
		const lines = (
			live: ReturnType<typeof menu>,
			draft: ReturnType<typeof menu>,
		) =>
			diffMenus(live, draft).flatMap(({ lines: found }) =>
				found.map(({ title, detail }) => [title, detail]),
			);
		expect(lines(menu([]), menu([{ interval: "month", amount: 500 }]))).toEqual(
			[["Monthly price none → $5.00", "Create a $5.00/month price"]],
		);
		expect(lines(menu([{ interval: "month", amount: 500 }]), menu([]))).toEqual(
			[["Monthly price $5.00 → none", "Archive the monthly price"]],
		);
		expect(
			lines(
				menu([{ interval: "month", amount: 500 }]),
				menu([{ interval: "month", amount: 700 }]),
			),
		).toEqual([
			[
				"Monthly price $5.00 → $7.00",
				"Create a $7.00/month price and archive the $5.00 one",
			],
		]);
		expect(lines(menu([]), menu([]))).toEqual([]);
	});
});
