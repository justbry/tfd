import { afterEach, expect, test } from "bun:test";
import type { Reader } from "../../src/data/reader.ts";
import { createFixtureReader } from "../../src/fixtures/reader.ts";
import { cleanUp, clock, count, open, text } from "../s5/helpers.ts";

/**
 * A school the ledger Worker has no views for yet (nothing has shipped) answers a null lag (S8-contract section 11).
 * It stays in the switcher, and a stale school with no lag says nothing has shipped, never "null min behind".
 */
afterEach(cleanUp);

const base = createFixtureReader({ clock });

test("a stale school with no ledger views yet says nothing has shipped, never a null lag", async () => {
	const reader: Reader = {
		...base,
		schools: async () =>
			(await base.schools()).map((school) =>
				school.id === "vol"
					? { ...school, stale: true, lagMinutes: null }
					: school,
			),
	};
	await open("#/vol/dashboard", { reader });
	expect(count("[data-test=stale-banner]")).toBe(1);
	const banner = text("[data-test=stale-banner]");
	expect(banner).toStartWith(
		"No ledger data has shipped yet: the shipper may be stuck.",
	);
	expect(banner).not.toContain("null");
});
