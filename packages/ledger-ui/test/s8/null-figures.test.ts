import { afterEach, expect, test } from "bun:test";
import type { IncomeStatement, LedgerPage } from "../../src/data/ledger.ts";
import type { Reader } from "../../src/data/reader.ts";
import { createFixtureReader } from "../../src/fixtures/reader.ts";
import { cleanUp, clock, count, open, text } from "../s5/helpers.ts";

/**
 * The ledger Worker answers null for a figure its source does not record (S8 contract §11, D11): discounts, gifts
 * sold, gifts outstanding and the Stripe match on the statement; the time zone, currency and unit of a ledger page
 * whose school published no menu. The UI shows each as not available, never as 0.
 */
afterEach(cleanUp);

const base = createFixtureReader({ clock });

test("a statement's null figures read as not available, never as $0.00", async () => {
	const statement = await base.incomeStatement({
		school: "vol",
		from: "2026-11-01",
		to: "2026-11-30",
		compare: false,
	});
	const reader: Reader = {
		...base,
		incomeStatement: async (): Promise<IncomeStatement> => ({
			...statement,
			matchesStripe: null,
			giftsOutstanding: null,
			amounts: { ...statement.amounts, discounts: null, giftsSold: null },
		}),
	};
	await open("#/vol/reports", { reader });
	expect(
		text(
			"[data-test=report-line][data-line=discounts] [data-test=report-line-amount]",
		),
	).toBe("—");
	expect(text("[data-test=report-line][data-line=gifts]")).toBe(
		"Not income: gift certificates sold: not available yet",
	);
	expect(text("[data-test=report-stripe-unchecked]")).toBe(
		"Not checked against Stripe yet.",
	);
	expect(count("[data-test=report-stripe-unchecked]")).toBe(1);
	expect(text("[data-test=report-status]")).not.toContain("Matches Stripe");
	expect(text("[data-test=report-status]")).not.toContain("Partial month");
});

test("a ledger page without a published menu takes the school's own time zone and unit", async () => {
	const reader: Reader = {
		...base,
		ledger: async (query): Promise<LedgerPage> => ({
			...(await base.ledger(query)),
			timeZone: null,
			currency: null,
			unit: null,
		}),
	};
	await open("#/vol/ledger?type=payout", { reader });
	expect(text("[data-test=ledger-count]")).toBe("1 event · America/Denver");
	expect(text("[data-test=ledger-credit-head]")).not.toBe("");
});

test("a statement without a published menu takes the school's own currency and unit, never no currency", async () => {
	const statement = await base.incomeStatement({
		school: "vol",
		from: "2026-11-01",
		to: "2026-11-30",
		compare: false,
	});
	const shown = (): string[] =>
		[...document.querySelectorAll("[data-test=report-line]")].map(
			(line) => line.textContent ?? "",
		);
	await open("#/vol/reports", { reader: base });
	const withMenu = shown();
	cleanUp();
	const reader: Reader = {
		...base,
		incomeStatement: async (): Promise<IncomeStatement> => ({
			...statement,
			currency: null,
			unit: null,
		}),
	};
	await open("#/vol/reports", { reader });
	expect(withMenu.length).toBeGreaterThan(0);
	// vol's own currency is the statement's, so the lines read the same
	expect(shown()).toEqual(withMenu);
	expect(shown().join(" ")).toContain("$");
});
