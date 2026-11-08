import { describe, expect, test } from "bun:test";
import { gunzip, gzip } from "../src/gzip.js";
import {
	countSetBits,
	createBitstring,
	decodeBitstring,
	encodeBitstring,
	getBit,
	MIN_STATUS_LIST_ENTRIES,
	randomUnusedIndex,
	statusEntry,
	withBit,
} from "../src/index.js";
import { multibaseBase64url } from "../src/multibase.js";
import { seededRandomBytes } from "../src/testing.js";

// Bitstring Status List v1.0 Example 3: the encodedList of an empty 16KB list (a public example value).
const SPEC_EMPTY_LIST =
	"uH4sIAAAAAAAAA-3BMQEAAADCoPVPbQwfoAAAAAAAAAAAAAAAAAAAAIC3AYbSVKsAQAAA";

describe("bitstring encoding", () => {
	test("the spec's example list decodes to 131,072 clear entries", async () => {
		const bits = await decodeBitstring(SPEC_EMPTY_LIST);
		expect(bits.length * 8).toBe(MIN_STATUS_LIST_ENTRIES);
		expect(countSetBits(bits)).toBe(0);
	});

	test("index 0 is the left-most bit of the first byte (§7.1)", () => {
		const bits = withBit(createBitstring(), 0, true);
		expect(bits[0]).toBe(0x80);
		const last = withBit(createBitstring(), MIN_STATUS_LIST_ENTRIES - 1, true);
		expect(last.at(-1)).toBe(0x01);
	});

	test("set, clear, encode and decode round-trip; inputs are never mutated", async () => {
		const empty = createBitstring();
		const set = withBit(withBit(empty, 94567, true), 7, true);
		expect(countSetBits(empty)).toBe(0);
		const decoded = await decodeBitstring(await encodeBitstring(set));
		expect(getBit(decoded, 94567)).toBe(true);
		expect(getBit(decoded, 7)).toBe(true);
		expect(getBit(decoded, 8)).toBe(false);
		expect(getBit(withBit(decoded, 7, false), 7)).toBe(false);
		expect((await encodeBitstring(set)).startsWith("uH4sI")).toBe(true);
	});

	test("lists under 16KB are refused when built and when read (§3.2 STATUS_LIST_LENGTH_ERROR)", async () => {
		expect(() => createBitstring(MIN_STATUS_LIST_ENTRIES - 8)).toThrow();
		expect(() => createBitstring(MIN_STATUS_LIST_ENTRIES + 1)).toThrow();
		const small = multibaseBase64url(await gzip(new Uint8Array(1024)));
		await expect(decodeBitstring(small)).rejects.toMatchObject({
			code: "status_list_too_short",
		});
	});

	test("bad multibase or gzip is status_list_invalid; inflation stops at the cap", async () => {
		await expect(decodeBitstring("zabc")).rejects.toMatchObject({
			code: "status_list_invalid",
		});
		await expect(decodeBitstring("uAAAA")).rejects.toMatchObject({
			code: "status_list_invalid",
		});
		const bomb = await gzip(new Uint8Array(1 << 20));
		await expect(gunzip(bomb, 1 << 16)).rejects.toThrow("inflates past");
		expect((await gunzip(bomb, 1 << 21)).length).toBe(1 << 20);
	});

	test("out-of-range indexes throw", () => {
		expect(() => getBit(createBitstring(), MIN_STATUS_LIST_ENTRIES)).toThrow();
		expect(() => withBit(createBitstring(), -1, true)).toThrow();
		expect(() => getBit(createBitstring(), 1.5)).toThrow();
	});
});

describe("random index allocation", () => {
	test("never returns an allocated index and is not sequential", () => {
		const random = seededRandomBytes("allocation");
		let allocations = createBitstring();
		const picked: number[] = [];
		for (let round = 0; round < 200; round++) {
			const index = randomUnusedIndex(allocations, random);
			expect(getBit(allocations, index)).toBe(false);
			allocations = withBit(allocations, index, true);
			picked.push(index);
		}
		expect(new Set(picked).size).toBe(200);
		const ascending = picked.every(
			(index, position) =>
				position === 0 || index > (picked[position - 1] as number),
		);
		expect(ascending).toBe(false);
	});

	test("a crowded list falls back to a scan; a full list throws", () => {
		const full = createBitstring().fill(0xff);
		const random = seededRandomBytes("crowded");
		expect(() => randomUnusedIndex(full, random)).toThrow("every index");
		const oneFree = withBit(full, 4242, false);
		expect(randomUnusedIndex(oneFree, random)).toBe(4242);
	});

	test("entries: index as a base-10 string, id distinct from the list URL", () => {
		const entry = statusEntry(
			"https://urlu.example/status/1",
			"revocation",
			94567,
		);
		expect(entry).toEqual({
			id: "https://urlu.example/status/1#94567",
			type: "BitstringStatusListEntry",
			statusPurpose: "revocation",
			statusListIndex: "94567",
			statusListCredential: "https://urlu.example/status/1",
		});
	});
});
