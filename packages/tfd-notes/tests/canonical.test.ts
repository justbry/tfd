// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import { Buffer } from "node:buffer";
import {
	canonicalJson,
	fromBase64Url,
	sha256Hex,
	toBase64Url,
	toHex,
	utf8Bytes,
} from "../src/canonical";

describe("canonicalJson", () => {
	it("sorts keys at every depth and writes no whitespace", () => {
		expect(
			canonicalJson({ b: 1, a: { d: [3, { z: true, y: null }], c: "x" } }),
		).toBe('{"a":{"c":"x","d":[3,{"y":null,"z":true}]},"b":1}');
	});

	it("orders keys by UTF-16 code unit, not by code point", () => {
		// U+1F600 is the surrogate pair D83D DE00; U+FB01 is a single unit above it. Code point order puts the emoji last.
		const text = canonicalJson({ ﬁ: 1, "\u{1F600}": 2, a: 3 });
		expect(text).toBe('{"a":3,"\u{1F600}":2,"ﬁ":1}');
	});

	it("is the same for any insertion order and drops undefined properties", () => {
		const first = canonicalJson({ one: 1, two: 2, gone: undefined });
		const second = canonicalJson({ two: 2, one: 1 });
		expect(first).toBe(second);
		expect(first).toBe('{"one":1,"two":2}');
	});

	it("escapes the way JSON.stringify does and leaves non-ASCII text as is", () => {
		expect(canonicalJson({ text: 'a"b\\c\n\u0001 café' })).toBe(
			JSON.stringify({ text: 'a"b\\c\n\u0001 café' }),
		);
	});

	it("writes integers and rejects every other number", () => {
		expect(canonicalJson([0, -7, 123456789])).toBe("[0,-7,123456789]");
		for (const bad of [
			1.5,
			Number.NaN,
			Number.POSITIVE_INFINITY,
			2 ** 53,
			0.1,
		]) {
			expect(() => canonicalJson({ amount: bad })).toThrow(/safe integer/);
		}
	});

	it("rejects a bigint", () => {
		expect(() => canonicalJson({ amount: 5n })).toThrow(/bigint/);
	});

	it("rejects a string or key that is not Unicode NFC", () => {
		const decomposed = "café";
		expect(decomposed).not.toBe(decomposed.normalize("NFC"));
		expect(() => canonicalJson({ text: decomposed })).toThrow(/NFC/);
		expect(() => canonicalJson({ [decomposed]: 1 })).toThrow(/NFC/);
		expect(canonicalJson({ text: decomposed.normalize("NFC") })).toBe(
			'{"text":"café"}',
		);
	});

	it("rejects a lone surrogate", () => {
		expect(() => canonicalJson({ text: "a\ud800b" })).toThrow(/surrogate/);
		expect(() => canonicalJson({ text: "\udc00" })).toThrow(/surrogate/);
		expect(canonicalJson({ text: "😀" })).toBe('{"text":"\u{1F600}"}');
	});

	it("rejects values that are not plain JSON data", () => {
		expect(() => canonicalJson(undefined)).toThrow();
		expect(() => canonicalJson([undefined])).toThrow();
		expect(() => canonicalJson(() => 1)).toThrow();
		expect(() => canonicalJson(new Date(0))).toThrow();
		expect(() => canonicalJson(new Map())).toThrow();
	});
});

describe("hashing and bytes", () => {
	it("sha256Hex hashes the UTF-8 bytes", async () => {
		for (const text of ["", "abc", "café \u{1F600}"]) {
			const expected = new Bun.CryptoHasher("sha256")
				.update(text)
				.digest("hex");
			expect(await sha256Hex(text)).toBe(expected);
		}
	});

	it("utf8Bytes encodes as UTF-8 and toHex is lowercase", () => {
		expect(Array.from(utf8Bytes("é"))).toEqual([0xc3, 0xa9]);
		expect(toHex(Uint8Array.from([0, 15, 16, 255]))).toBe("000f10ff");
	});

	it("base64url matches the unpadded url-safe spelling for every length", () => {
		for (let length = 0; length <= 40; length += 1) {
			const bytes = Uint8Array.from(
				{ length },
				(_, index) => (index * 37 + 250) % 256,
			);
			const text = toBase64Url(bytes);
			expect(text).toBe(Buffer.from(bytes).toString("base64url"));
			expect(Array.from(fromBase64Url(text))).toEqual(Array.from(bytes));
		}
	});

	it("base64url has one spelling: no padding, no other alphabet, no stray bits", () => {
		expect(() => fromBase64Url("AA==")).toThrow();
		expect(() => fromBase64Url("+/+/")).toThrow();
		expect(() => fromBase64Url("AAAAA")).toThrow(/length/);
		expect(() => fromBase64Url("AB")).toThrow(/trailing/);
		expect(() => fromBase64Url("AA ")).toThrow();
		expect(Array.from(fromBase64Url("AA"))).toEqual([0]);
	});
});
