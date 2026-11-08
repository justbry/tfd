import { sha256 } from "@noble/hashes/sha2.js";

const encoder = new TextEncoder();

export const utf8 = (text: string): Uint8Array => encoder.encode(text);

export const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
	let length = 0;
	for (const part of parts) length += part.length;
	const out = new Uint8Array(length);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
};

export const sha256Bytes = (bytes: Uint8Array): Uint8Array => sha256(bytes);

export const toHex = (bytes: Uint8Array): string => {
	let out = "";
	for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
	return out;
};

export const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean => {
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index++) {
		if (left[index] !== right[index]) return false;
	}
	return true;
};

const LONE_SURROGATE = /\p{Surrogate}/u;

/** False for a string with a lone surrogate, which has no UTF-8 form (`String.prototype.isWellFormed` is ES2024). */
export const isWellFormed = (text: string): boolean =>
	!LONE_SURROGATE.test(text);
