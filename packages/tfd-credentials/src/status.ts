/**
 * Bitstring Status List v1.0 (W3C Recommendation 15 May 2025, https://www.w3.org/TR/vc-bitstring-status-list/):
 *
 * - index 0 is the left-most bit (§2.2, §7.1), so bit i lives in byte i>>3 under mask 0x80>>(i&7);
 * - the uncompressed list is at least 16KB, i.e. 131,072 entries of one bit (§2.2, §3.2 minimumNumberOfEntries);
 * - `encodedList` is multibase base64url, no padding (`u`), of the GZIP of the bitstring (§2.2, §3.3);
 * - indexes SHOULD be assigned randomly (§2.1 statusListIndex), hence `randomUnusedIndex` with injected entropy.
 */

import { CredentialsError } from "./errors.js";
import { gunzip, gzip } from "./gzip.js";
import { decodeMultibaseBase64url, multibaseBase64url } from "./multibase.js";
import {
	type BitstringStatusListCredential,
	type BitstringStatusListEntry,
	STATUS_LIST_CONTEXT,
	type StatusPurpose,
} from "./types.js";

export const MIN_STATUS_LIST_ENTRIES = 131_072;
/** A decoded list larger than this (128 Mi entries) is refused rather than inflated. */
export const MAX_STATUS_LIST_BYTES = 16 * 1024 * 1024;

/** Entropy port: `length` uniformly random bytes (crypto.getRandomValues in production). */
export type RandomBytes = (length: number) => Uint8Array;

export const createBitstring = (
	entries: number = MIN_STATUS_LIST_ENTRIES,
): Uint8Array => {
	if (
		!Number.isInteger(entries) ||
		entries < MIN_STATUS_LIST_ENTRIES ||
		entries % 8 !== 0
	) {
		throw new CredentialsError(
			"status_list_too_short",
			`a status list holds a multiple of 8 entries, at least ${MIN_STATUS_LIST_ENTRIES}`,
		);
	}
	return new Uint8Array(entries / 8);
};

const checkIndex = (bits: Uint8Array, index: number): void => {
	if (!Number.isInteger(index) || index < 0 || index >= bits.length * 8) {
		throw new CredentialsError(
			"status_index_out_of_range",
			`index ${index} is outside a list of ${bits.length * 8}`,
		);
	}
};

export const getBit = (bits: Uint8Array, index: number): boolean => {
	checkIndex(bits, index);
	return ((bits[index >> 3] as number) & (0x80 >> (index & 7))) !== 0;
};

/** A copy of `bits` with entry `index` set or cleared; the input is not changed. */
export const withBit = (
	bits: Uint8Array,
	index: number,
	value: boolean,
): Uint8Array => {
	checkIndex(bits, index);
	const copy = bits.slice();
	const mask = 0x80 >> (index & 7);
	const byte = copy[index >> 3] as number;
	copy[index >> 3] = value ? byte | mask : byte & ~mask;
	return copy;
};

export const countSetBits = (bits: Uint8Array): number => {
	let count = 0;
	for (const byte of bits) {
		let value = byte;
		while (value !== 0) {
			value &= value - 1;
			count++;
		}
	}
	return count;
};

export const encodeBitstring = async (bits: Uint8Array): Promise<string> =>
	multibaseBase64url(await gzip(bits));

/** Throws `status_list_invalid` for bad encoding or gzip, `status_list_too_short` under the minimum. */
export const decodeBitstring = async (
	encodedList: string,
	minimumEntries: number = MIN_STATUS_LIST_ENTRIES,
): Promise<Uint8Array> => {
	let bits: Uint8Array;
	try {
		bits = await gunzip(
			decodeMultibaseBase64url(encodedList),
			MAX_STATUS_LIST_BYTES,
		);
	} catch (error) {
		throw new CredentialsError(
			"status_list_invalid",
			`encodedList: ${error instanceof Error ? error.message : "undecodable"}`,
		);
	}
	if (bits.length * 8 < minimumEntries) {
		throw new CredentialsError(
			"status_list_too_short",
			`the list holds ${bits.length * 8} entries, under the minimum ${minimumEntries}`,
		);
	}
	return bits;
};

const RANDOM_DRAWS = 64;
const UINT32_RANGE = 2 ** 32;

const randomBelow = (
	bound: number,
	randomBytes: RandomBytes,
): number | null => {
	const bytes = randomBytes(4);
	if (bytes.length !== 4) {
		throw new CredentialsError(
			"input_invalid",
			"randomBytes must return the length asked for",
		);
	}
	const value =
		(((bytes[0] as number) << 24) >>> 0) +
		((bytes[1] as number) << 16) +
		((bytes[2] as number) << 8) +
		(bytes[3] as number);
	// Rejection sampling keeps the draw uniform when bound does not divide 2^32.
	const limit = UINT32_RANGE - (UINT32_RANGE % bound);
	return value < limit ? value % bound : null;
};

/**
 * A uniformly random index whose allocation bit is clear. Draws at random first; on a crowded list it scans from a
 * random start. Throws `status_list_full` when every entry is taken.
 */
export const randomUnusedIndex = (
	allocations: Uint8Array,
	randomBytes: RandomBytes,
): number => {
	const entries = allocations.length * 8;
	for (let draw = 0; draw < RANDOM_DRAWS; draw++) {
		const index = randomBelow(entries, randomBytes);
		if (index !== null && !getBit(allocations, index)) return index;
	}
	let start: number | null = null;
	while (start === null) start = randomBelow(entries, randomBytes);
	for (let step = 0; step < entries; step++) {
		const index = (start + step) % entries;
		if (!getBit(allocations, index)) return index;
	}
	throw new CredentialsError(
		"status_list_full",
		"every index in the list is allocated",
	);
};

/** The entry a credential carries. Its id is `<list>#<index>`, never the list URL itself (BSL §2.1 id). */
export const statusEntry = (
	statusListCredential: string,
	statusPurpose: StatusPurpose,
	index: number,
): BitstringStatusListEntry => ({
	id: `${statusListCredential}#${index}`,
	type: "BitstringStatusListEntry",
	statusPurpose,
	statusListIndex: String(index),
	statusListCredential,
});

/** An unsigned BitstringStatusListCredential (BSL §2.2). Sign it with `addProof`. */
export const buildStatusListCredential = (input: {
	id: string;
	issuer: string;
	statusPurpose: StatusPurpose;
	encodedList: string;
	validFrom: string;
	validUntil?: string;
	ttl?: number;
}): BitstringStatusListCredential => {
	const credential: BitstringStatusListCredential = {
		"@context": [...STATUS_LIST_CONTEXT],
		id: input.id,
		type: ["VerifiableCredential", "BitstringStatusListCredential"],
		issuer: input.issuer,
		validFrom: input.validFrom,
		credentialSubject: {
			id: `${input.id}#list`,
			type: "BitstringStatusList",
			statusPurpose: input.statusPurpose,
			encodedList: input.encodedList,
		},
	};
	if (input.validUntil !== undefined) credential.validUntil = input.validUntil;
	if (input.ttl !== undefined) credential.credentialSubject.ttl = input.ttl;
	return credential;
};
