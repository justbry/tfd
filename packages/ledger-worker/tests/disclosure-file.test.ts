/** The B4 Uni file shipped with the Worker is the one the UI ships; the school's size is the last closed year's gross against `largeFrom`. */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DISCLOSURE_FILE, sizeOf } from "../src/data/disclosure.js";

const UI_FIXTURE = join(
	import.meta.dir,
	"../../ledger-ui/src/fixtures/disclosure.json",
);

describe("the disclosure file", () => {
	test.skipIf(!existsSync(UI_FIXTURE))(
		"equals the file packages/ledger-ui ships (its fixture's `file`)",
		() => {
			const fixture = JSON.parse(readFileSync(UI_FIXTURE, "utf8")) as {
				file: unknown;
			};
			expect(DISCLOSURE_FILE).toEqual(fixture.file as never);
		},
	);
});

describe("size", () => {
	const gross = (period: string, value: number) => ({
		kpiId: "gross_collected",
		period,
		unit: "cents",
		value,
	});
	const { largeFrom } = DISCLOSURE_FILE.rounding;

	test("small without a closed year, large from largeFrom of the last closed year's gross", () => {
		expect(sizeOf([], 2026)).toBe("small");
		expect(sizeOf([gross("2026-03", largeFrom * 5)], 2026)).toBe("small");
		expect(sizeOf([gross("2025-03", largeFrom - 1)], 2026)).toBe("small");
		expect(
			sizeOf([gross("2025-03", largeFrom - 1), gross("2025-04", 1)], 2026),
		).toBe("large");
		expect(sizeOf([gross("2024-12", largeFrom * 5)], 2026)).toBe("small");
	});
});
