// SPDX-License-Identifier: Apache-2.0
/** tfd-verify reads each key text in pem-cases.ts as tfd does: the same verdict for the same signature. */
import { describe, expect, test } from "bun:test";
import { verifyBytes } from "../src/core";
import { CASES, KEY_ID, sig, TEXT } from "./pem-cases";

describe("tfd-verify reads a key text as tfd does", () => {
	test.each(CASES)("%s", async (_name, pem, expected) => {
		expect(await verifyBytes(TEXT, KEY_ID, sig, { [KEY_ID]: pem })).toBe(
			expected,
		);
	});
});
