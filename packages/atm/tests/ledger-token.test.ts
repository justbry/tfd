import { describe, expect, test } from "bun:test";
import {
	isLedgerTokenAudience,
	LEDGER_TOKEN_AUDIENCE,
	LEDGER_TOKEN_AUDIENCES,
	LEGACY_LEDGER_TOKEN_AUDIENCE,
} from "../src/worker.js";

describe("the ledger token's audience, for the rename window", () => {
	test("the new audience is tfd-ledger and the old one atm-ledger, the new one first", () => {
		expect(LEDGER_TOKEN_AUDIENCE).toBe("tfd-ledger");
		expect(LEGACY_LEDGER_TOKEN_AUDIENCE).toBe("atm-ledger");
		expect([...LEDGER_TOKEN_AUDIENCES]).toEqual(["tfd-ledger", "atm-ledger"]);
	});

	test("accepts tfd-ledger", () => {
		expect(isLedgerTokenAudience("tfd-ledger")).toBe(true);
	});

	test("accepts atm-ledger, which buzz-school mints today", () => {
		expect(isLedgerTokenAudience("atm-ledger")).toBe(true);
	});

	test("refuses a wrong audience, a near miss, an array, and a missing claim", () => {
		for (const audience of [
			"atm-embed",
			"tfd-embed",
			"ledger",
			"TFD-LEDGER",
			" tfd-ledger",
			"tfd-ledger ",
			"",
			["tfd-ledger"],
			["atm-ledger", "tfd-ledger"],
			undefined,
			null,
			1,
		])
			expect(isLedgerTokenAudience(audience)).toBe(false);
	});
});
