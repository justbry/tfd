// SPDX-License-Identifier: Apache-2.0
/**
 * Canonical JSON and the byte helpers every signed note document builds on. Pure: no `node:` imports, no dependencies;
 * hashing goes through WebCrypto (`crypto.subtle`), which Bun, Node, Workers and browsers all have, so `sha256Hex` is
 * async.
 */

const ENCODER = new TextEncoder();

const HIGH_SURROGATE_START = 0xd800;
const HIGH_SURROGATE_END = 0xdbff;
const LOW_SURROGATE_START = 0xdc00;
const LOW_SURROGATE_END = 0xdfff;

const isHighSurrogate = (unit: number): boolean =>
	unit >= HIGH_SURROGATE_START && unit <= HIGH_SURROGATE_END;

const isLowSurrogate = (unit: number): boolean =>
	unit >= LOW_SURROGATE_START && unit <= LOW_SURROGATE_END;

const hasLoneSurrogate = (text: string): boolean => {
	for (let index = 0; index < text.length; index += 1) {
		const unit = text.charCodeAt(index);
		if (isHighSurrogate(unit)) {
			if (!isLowSurrogate(text.charCodeAt(index + 1))) return true;
			index += 1;
		} else if (isLowSurrogate(unit)) {
			return true;
		}
	}
	return false;
};

/** A string is signable text when it is well formed UTF-16 and already Unicode NFC, so one text has one byte spelling. */
const checkText = (text: string, where: string): void => {
	if (hasLoneSurrogate(text)) {
		throw new Error(`canonicalJson: lone surrogate in ${where}`);
	}
	if (text !== text.normalize("NFC")) {
		throw new Error(`canonicalJson: string is not Unicode NFC in ${where}`);
	}
};

const isPlainObject = (value: object): boolean => {
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
};

const render = (value: unknown, where: string): string => {
	if (value === null) return "null";
	if (typeof value === "boolean") return value ? "true" : "false";
	if (typeof value === "string") {
		checkText(value, where);
		return JSON.stringify(value);
	}
	if (typeof value === "number") {
		if (!Number.isSafeInteger(value)) {
			throw new Error(
				`canonicalJson: ${where} is a number that is not a safe integer (the engine has no floats)`,
			);
		}
		return JSON.stringify(value);
	}
	if (typeof value === "bigint") {
		throw new Error(
			`canonicalJson: ${where} is a bigint; carry money as a digit string`,
		);
	}
	if (Array.isArray(value)) {
		const parts: string[] = [];
		for (const [index, item] of value.entries()) {
			parts.push(render(item, `${where}[${index}]`));
		}
		return `[${parts.join(",")}]`;
	}
	if (typeof value === "object" && isPlainObject(value)) {
		const keys = Object.keys(value)
			.filter((key) => (value as Record<string, unknown>)[key] !== undefined)
			// Default string comparison orders by UTF-16 code unit, the order tfd's `canonicalize` uses.
			.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
		const parts: string[] = [];
		for (const key of keys) {
			checkText(key, `${where} key`);
			parts.push(
				`${JSON.stringify(key)}:${render((value as Record<string, unknown>)[key], `${where}.${key}`)}`,
			);
		}
		return `{${parts.join(",")}}`;
	}
	throw new Error(
		`canonicalJson: ${where} is a ${typeof value}, not JSON data`,
	);
};

/**
 * JSON with object keys sorted by UTF-16 code unit order and no whitespace. For any input it accepts, the output is
 * byte for byte what tfd's existing `canonicalize` (packages/atm/src/ledger/util.ts) returns, so a note document and a
 * ledger receipt are canonicalised the same way. `undefined` properties are dropped, as in `canonicalize`.
 *
 * Throws, so a document that could be read two ways is never signed, on: a number that is not a safe integer (no
 * floats, no NaN or infinity), a `bigint`, a string or key that is not Unicode NFC, a lone surrogate, an `undefined`
 * array item or top-level value, and anything that is not plain JSON data (functions, symbols, class instances).
 */
export const canonicalJson = (value: unknown): string => render(value, "value");

/** The UTF-8 bytes of `text`. */
export const utf8Bytes = (text: string): Uint8Array => ENCODER.encode(text);

const HEX_DIGITS = "0123456789abcdef";

/** Lowercase hex of `bytes`. */
export const toHex = (bytes: Uint8Array): string => {
	let hex = "";
	for (const byte of bytes) {
		hex += HEX_DIGITS[byte >> 4] + HEX_DIGITS[byte & 0x0f];
	}
	return hex;
};

/** sha256 of the UTF-8 bytes of `text`, as 64 lowercase hex characters. */
export const sha256Hex = async (text: string): Promise<string> => {
	const digest = await crypto.subtle.digest("SHA-256", utf8Bytes(text));
	return toHex(new Uint8Array(digest));
};

const BASE64URL_ALPHABET =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const SEXTET_BITS = 6;
const BYTE_BITS = 8;
const SEXTET_MASK = 0x3f;

/** base64url of `bytes` with no padding: the one spelling a signature or hash has in a document. */
export const toBase64Url = (bytes: Uint8Array): string => {
	let text = "";
	let buffer = 0;
	let bits = 0;
	for (const byte of bytes) {
		buffer = (buffer << BYTE_BITS) | byte;
		bits += BYTE_BITS;
		while (bits >= SEXTET_BITS) {
			bits -= SEXTET_BITS;
			text += BASE64URL_ALPHABET[(buffer >> bits) & SEXTET_MASK];
		}
		buffer &= (1 << bits) - 1;
	}
	if (bits > 0) {
		text += BASE64URL_ALPHABET[(buffer << (SEXTET_BITS - bits)) & SEXTET_MASK];
	}
	return text;
};

/**
 * The bytes of a base64url string. Strict: only the url-safe alphabet, no padding, no whitespace, and the unused trailing
 * bits must be zero, so `toBase64Url(fromBase64Url(text)) === text` and one byte string has exactly one spelling.
 */
export const fromBase64Url = (text: string): Uint8Array => {
	if (text.length % 4 === 1) {
		throw new Error("base64url: length cannot be 1 more than a multiple of 4");
	}
	const bytes: number[] = [];
	let buffer = 0;
	let bits = 0;
	for (const character of text) {
		const sextet = BASE64URL_ALPHABET.indexOf(character);
		if (sextet < 0) {
			throw new Error(`base64url: ${JSON.stringify(character)} is not allowed`);
		}
		buffer = (buffer << SEXTET_BITS) | sextet;
		bits += SEXTET_BITS;
		if (bits >= BYTE_BITS) {
			bits -= BYTE_BITS;
			bytes.push((buffer >> bits) & 0xff);
			buffer &= (1 << bits) - 1;
		}
	}
	if (buffer !== 0) {
		throw new Error("base64url: trailing bits are not zero");
	}
	return Uint8Array.from(bytes);
};
