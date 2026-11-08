import { afterEach, expect, test } from "bun:test";
import type { Reader } from "../../src/data/reader.ts";
import { createFixtureReader } from "../../src/fixtures/reader.ts";
import { cleanUp, clock, count, open, text } from "../s5/helpers.ts";

/**
 * A school the ledger Worker has no views for yet (nothing has shipped) answers a null lag (S8-contract section 11).
 * It stays in the switcher and says, calmly, that it has no ledger data yet: no data is not a stuck shipper (owner
 * report 2026-11-08), so the stuck warning shows only for a school with a lag that the Worker says is stale.
 */
afterEach(cleanUp);

const base = createFixtureReader({ clock });
const withVol = (change: { stale: boolean; lagMinutes: number | null }) => ({
	...base,
	schools: async () =>
		(await base.schools()).map((school) =>
			school.id === "vol" ? { ...school, ...change } : school,
		),
});

test("a school with no ledger views yet says so calmly, never that the shipper is stuck or a null lag", async () => {
	for (const stale of [true, false]) {
		const reader: Reader = withVol({ stale, lagMinutes: null });
		await open("#/vol/dashboard", { reader });
		expect(count("[data-test=stale-banner]")).toBe(0);
		expect(text("[data-test=no-data-banner]")).toBe(
			"No ledger data for this school yet.",
		);
		expect(document.body.textContent).not.toContain("shipper may be stuck");
		expect(document.body.textContent).not.toContain("null");
		cleanUp();
	}
});

test("a school with a lag the Worker says is stale keeps the stuck warning", async () => {
	await open("#/vol/dashboard", {
		reader: withVol({ stale: true, lagMinutes: 40 }),
	});
	expect(text("[data-test=stale-banner]")).toStartWith(
		"Data is 40 min behind: the shipper may be stuck.",
	);
	expect(count("[data-test=no-data-banner]")).toBe(0);
});
