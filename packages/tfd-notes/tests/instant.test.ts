// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import { addDaysToInstant, compareInstants, isInstant } from "../src/instant";

describe("isInstant", () => {
	it("accepts a UTC instant with or without a fraction", () => {
		expect(isInstant("2026-03-05T12:00:00Z")).toBe(true);
		expect(isInstant("2026-03-05T12:00:00.123456789Z")).toBe(true);
	});

	it("refuses other spellings, impossible dates and non-strings", () => {
		for (const value of [
			"2026-03-05T12:00:00+00:00",
			"2026-03-05 12:00:00Z",
			"2026-02-30T12:00:00Z",
			"2026-03-05T24:00:00Z",
			"",
			undefined,
			null,
			20_260_305,
		]) {
			expect(isInstant(value)).toBe(false);
		}
	});
});

describe("compareInstants", () => {
	it("orders by second and then by fraction as a number", () => {
		expect(
			compareInstants("2026-03-05T12:00:00Z", "2026-03-05T12:00:01Z"),
		).toBe(-1);
		expect(
			compareInstants("2026-03-05T12:00:01Z", "2026-03-05T12:00:00Z"),
		).toBe(1);
		expect(
			compareInstants("2026-03-05T12:00:00Z", "2026-03-05T12:00:00.0Z"),
		).toBe(0);
		expect(
			compareInstants("2026-03-05T12:00:00.5Z", "2026-03-05T12:00:00.51Z"),
		).toBe(-1);
		expect(
			compareInstants("2026-03-05T12:00:00.5Z", "2026-03-05T12:00:00Z"),
		).toBe(1);
	});
});

describe("addDaysToInstant", () => {
	it("keeps the time of day and counts calendar days, leap years included", () => {
		expect(addDaysToInstant("2026-03-05T12:34:56.5Z", 30)).toBe(
			"2026-04-04T12:34:56.5Z",
		);
		expect(addDaysToInstant("2028-02-28T00:00:00Z", 2)).toBe(
			"2028-03-01T00:00:00Z",
		);
		expect(addDaysToInstant("2026-12-31T23:59:59Z", 1)).toBe(
			"2027-01-01T23:59:59Z",
		);
	});
});
