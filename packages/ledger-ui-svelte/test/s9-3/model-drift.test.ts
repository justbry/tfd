import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { monthOfPeriod, type Period } from "$contract/app/period.ts";
import { viewedMonthOf } from "../../src/app/plans/overview-model.ts";

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

describe("the copies of the Preact package's Plans logic", () => {
	test("plans-menu.ts has the original's body", () => {
		expect(body(copy("plans-menu.ts"))).toBe(body(original("plans-menu.ts")));
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
