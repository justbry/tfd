/**
 * tfd's own key reading against tfd-verify's: each key text in packages/verify/tests/pem-cases.ts goes through tfd's
 * verifyBytes (node:crypto under Bun) and the site's tfd-verify, and both must give the pinned verdict.
 */
import { describe, expect, test } from "bun:test";
import { verifyBytes } from "tfd-verify";
import { verifyBytes as tfdVerifyBytes } from "../../../packages/atm/src/ledger/sign.ts";
import {
	CASES,
	KEY_ID,
	sig,
	TEXT,
} from "../../../packages/verify/tests/pem-cases.ts";

describe("tfd and tfd-verify read a key text the same way", () => {
	test.each(CASES)("%s", async (_name, pem, expected) => {
		const keys = { [KEY_ID]: pem };
		expect(tfdVerifyBytes(TEXT, KEY_ID, sig, keys)).toBe(expected);
		expect(await verifyBytes(TEXT, KEY_ID, sig, keys)).toBe(expected);
	});
});
