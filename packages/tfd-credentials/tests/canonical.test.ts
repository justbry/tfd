import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { canonicalize as atmCanonicalize } from "../../atm/src/ledger/util.js";
import { canonicalBytes, canonicalize } from "../src/index.js";

// RFC 8785 §3.2.2 sample input, its §3.2.3 canonical form, and the §3.2.3 sorting input, copied from the RFC into
// files: Bun's transpiler cooks \u escapes even inside String.raw.
const vector = (name: string): Promise<string> =>
	Bun.file(join(import.meta.dir, "vectors", name)).text();
const SAMPLE_INPUT = await vector("rfc8785-sample-input.txt");
const SAMPLE_CANONICAL = await vector("rfc8785-sample-canonical.txt");
const SORT_INPUT = await vector("rfc8785-sort-input.txt");

// RFC 8785 §3.2.4: the UTF-8 bytes of the canonical sample.
const SAMPLE_BYTES = [
	0x7b, 0x22, 0x6c, 0x69, 0x74, 0x65, 0x72, 0x61, 0x6c, 0x73, 0x22, 0x3a, 0x5b,
	0x6e, 0x75, 0x6c, 0x6c, 0x2c, 0x74, 0x72, 0x75, 0x65, 0x2c, 0x66, 0x61, 0x6c,
	0x73, 0x65, 0x5d, 0x2c, 0x22, 0x6e, 0x75, 0x6d, 0x62, 0x65, 0x72, 0x73, 0x22,
	0x3a, 0x5b, 0x33, 0x33, 0x33, 0x33, 0x33, 0x33, 0x33, 0x33, 0x33, 0x2e, 0x33,
	0x33, 0x33, 0x33, 0x33, 0x33, 0x33, 0x2c, 0x31, 0x65, 0x2b, 0x33, 0x30, 0x2c,
	0x34, 0x2e, 0x35, 0x2c, 0x30, 0x2e, 0x30, 0x30, 0x32, 0x2c, 0x31, 0x65, 0x2d,
	0x32, 0x37, 0x5d, 0x2c, 0x22, 0x73, 0x74, 0x72, 0x69, 0x6e, 0x67, 0x22, 0x3a,
	0x22, 0xe2, 0x82, 0xac, 0x24, 0x5c, 0x75, 0x30, 0x30, 0x30, 0x66, 0x5c, 0x6e,
	0x41, 0x27, 0x42, 0x5c, 0x22, 0x5c, 0x5c, 0x5c, 0x5c, 0x5c, 0x22, 0x2f, 0x22,
	0x7d,
];

// RFC 8785 Appendix B: IEEE 754 bit patterns and their serialisation (NaN and Infinity have none).
const NUMBER_SAMPLES: [string, string | null][] = [
	["0000000000000000", "0"],
	["8000000000000000", "0"],
	["0000000000000001", "5e-324"],
	["8000000000000001", "-5e-324"],
	["7fefffffffffffff", "1.7976931348623157e+308"],
	["ffefffffffffffff", "-1.7976931348623157e+308"],
	["4340000000000000", "9007199254740992"],
	["c340000000000000", "-9007199254740992"],
	["4430000000000000", "295147905179352830000"],
	["7fffffffffffffff", null],
	["7ff0000000000000", null],
	["44b52d02c7e14af5", "9.999999999999997e+22"],
	["44b52d02c7e14af6", "1e+23"],
	["44b52d02c7e14af7", "1.0000000000000001e+23"],
	["444b1ae4d6e2ef4e", "999999999999999700000"],
	["444b1ae4d6e2ef4f", "999999999999999900000"],
	["444b1ae4d6e2ef50", "1e+21"],
	["3eb0c6f7a0b5ed8c", "9.999999999999997e-7"],
	["3eb0c6f7a0b5ed8d", "0.000001"],
	["41b3de4355555553", "333333333.3333332"],
	["41b3de4355555554", "333333333.33333325"],
	["41b3de4355555555", "333333333.3333333"],
	["41b3de4355555556", "333333333.3333334"],
	["41b3de4355555557", "333333333.33333343"],
	["becbf647612f3696", "-0.0000033333333333333333"],
	["43143ff3c1cb0959", "1424953923781206.2"],
];

const fromIeee754 = (hex: string): number => {
	const view = new DataView(new ArrayBuffer(8));
	view.setBigUint64(0, BigInt(`0x${hex}`));
	return view.getFloat64(0);
};

describe("RFC 8785 vectors", () => {
	test("§3.2.2–3.2.3 sample canonicalises exactly", () => {
		expect(canonicalize(JSON.parse(SAMPLE_INPUT))).toBe(SAMPLE_CANONICAL);
	});

	test("§3.2.4 sample UTF-8 bytes", () => {
		expect([...canonicalBytes(JSON.parse(SAMPLE_INPUT))]).toEqual(SAMPLE_BYTES);
	});

	test("§3.2.3 sorts property names by UTF-16 code units", () => {
		const input = JSON.parse(SORT_INPUT);
		// JSON.parse of the canonical text would put "1" first again, so read the order from the text itself.
		const order = [...canonicalize(input).matchAll(/:"([^"]+)"/g)].map(
			(match) => match[1],
		);
		expect(order).toEqual([
			"Carriage Return",
			"One",
			"Control",
			"Latin Small Letter O With Diaeresis",
			"Euro Sign",
			"Emoji: Grinning Face",
			"Hebrew Letter Dalet With Dagesh",
		]);
	});

	for (const [hex, expected] of NUMBER_SAMPLES) {
		test(`Appendix B ${hex}`, () => {
			const value = fromIeee754(hex);
			if (expected === null) {
				expect(() => canonicalize(value)).toThrow("NaN or Infinity");
			} else {
				expect(canonicalize(value)).toBe(expected);
			}
		});
	}
});

describe("strictness", () => {
	test("a lone surrogate throws (§3.2.2.2), in values and in keys", () => {
		expect(() => canonicalize({ a: "\ud800" })).toThrow("lone surrogate");
		expect(() => canonicalize({ "\udead": 1 })).toThrow("lone surrogate");
	});

	test("non-JSON values throw; undefined members are skipped like JSON.stringify", () => {
		expect(() => canonicalize([undefined])).toThrow("undefined in array");
		expect(() => canonicalize({ when: new Date(0) })).toThrow(
			"not a plain object",
		);
		expect(() => canonicalize({ big: 1n })).toThrow("bigint");
		expect(canonicalize({ b: 1, a: undefined })).toBe('{"b":1}');
	});

	test("nested objects inside arrays are sorted, array order is kept", () => {
		expect(canonicalize([{ b: 1, a: 2 }, 3, [{ d: 0, c: 1 }]])).toBe(
			'[{"a":2,"b":1},3,[{"c":1,"d":0}]]',
		);
	});
});

// atm's ledger canonicalize (packages/atm/src/ledger/util.ts) is JSON.stringify of a key-sorted copy. It agrees with
// JCS on ordinary ASCII-keyed JSON and differs in exactly these places; atm's must never sign credentials.
describe("where atm's ledger canonicalize differs from RFC 8785", () => {
	test("agrees on ordinary data", () => {
		const value = { z: [1, 2.5, "x"], a: { c: true, b: null }, "a-b": "€" };
		expect(atmCanonicalize(value)).toBe(canonicalize(value));
	});

	test("integer-like keys: atm emits them numerically first, JCS by code unit", () => {
		const value = { "10": 1, "9": 2, a: 3 };
		expect(atmCanonicalize(value)).toBe('{"9":2,"10":1,"a":3}');
		expect(canonicalize(value)).toBe('{"10":1,"9":2,"a":3}');
	});

	test("NaN and Infinity: atm emits null, JCS throws", () => {
		expect(atmCanonicalize({ n: Number.NaN })).toBe('{"n":null}');
		expect(() => canonicalize({ n: Number.NaN })).toThrow();
	});

	test("lone surrogates: atm escapes them, JCS throws", () => {
		expect(atmCanonicalize("\ud800")).toBe('"\\ud800"');
		expect(() => canonicalize("\ud800")).toThrow();
	});

	test("a Date and undefined in arrays: atm emits {} and null, JCS throws", () => {
		expect(atmCanonicalize([new Date(0), undefined])).toBe("[{},null]");
		expect(() => canonicalize([new Date(0)])).toThrow();
	});
});
