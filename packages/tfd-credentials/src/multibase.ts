/**
 * The two multibase encodings the specs use: base58btc (`z`) for keys and proof values (Controlled Identifiers v1.0
 * §2.4) and base64url without padding (`u`) for Bitstring Status List `encodedList` and `digestMultibase`
 * (RFC 4648 §5). Hand-written because neither Buffer nor atob exists everywhere this runs.
 */
import { CredentialsError } from "./errors.js";

const BASE58_ALPHABET =
	"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_INDEX = new Map(
	[...BASE58_ALPHABET].map((character, index) => [character, index]),
);

export const base58btcEncode = (bytes: Uint8Array): string => {
	let zeros = 0;
	while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
	// Base-256 to base-58 by repeated division; digits are little-endian until reversed.
	const digits: number[] = [];
	for (let index = zeros; index < bytes.length; index++) {
		let carry = bytes[index] as number;
		for (let digit = 0; digit < digits.length; digit++) {
			carry += (digits[digit] as number) << 8;
			digits[digit] = carry % 58;
			carry = Math.floor(carry / 58);
		}
		while (carry > 0) {
			digits.push(carry % 58);
			carry = Math.floor(carry / 58);
		}
	}
	let out = "1".repeat(zeros);
	for (let digit = digits.length - 1; digit >= 0; digit--) {
		out += BASE58_ALPHABET[digits[digit] as number];
	}
	return out;
};

export const base58btcDecode = (text: string): Uint8Array => {
	let zeros = 0;
	while (zeros < text.length && text[zeros] === "1") zeros++;
	const bytes: number[] = [];
	for (let index = zeros; index < text.length; index++) {
		const value = BASE58_INDEX.get(text[index] as string);
		if (value === undefined) {
			throw new CredentialsError(
				"multibase_invalid",
				`not a base58btc character at ${index}`,
			);
		}
		let carry = value;
		for (let byte = 0; byte < bytes.length; byte++) {
			carry += (bytes[byte] as number) * 58;
			bytes[byte] = carry & 0xff;
			carry >>= 8;
		}
		while (carry > 0) {
			bytes.push(carry & 0xff);
			carry >>= 8;
		}
	}
	const out = new Uint8Array(zeros + bytes.length);
	for (let index = 0; index < bytes.length; index++) {
		out[out.length - 1 - index] = bytes[index] as number;
	}
	return out;
};

const BASE64URL_ALPHABET =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const BASE64URL_INDEX = new Map(
	[...BASE64URL_ALPHABET].map((character, index) => [character, index]),
);

const symbol = (value: number): string => BASE64URL_ALPHABET.charAt(value & 63);

export const base64urlEncode = (bytes: Uint8Array): string => {
	let out = "";
	let index = 0;
	for (; index + 2 < bytes.length; index += 3) {
		const triple =
			((bytes[index] as number) << 16) |
			((bytes[index + 1] as number) << 8) |
			(bytes[index + 2] as number);
		out +=
			symbol(triple >> 18) +
			symbol(triple >> 12) +
			symbol(triple >> 6) +
			symbol(triple);
	}
	const rest = bytes.length - index;
	if (rest === 1) {
		const value = (bytes[index] as number) << 16;
		out += symbol(value >> 18) + symbol(value >> 12);
	} else if (rest === 2) {
		const value =
			((bytes[index] as number) << 16) | ((bytes[index + 1] as number) << 8);
		out += symbol(value >> 18) + symbol(value >> 12) + symbol(value >> 6);
	}
	return out;
};

/** Strict: no padding, no `+` or `/`, no whitespace, and no length that cannot come from whole bytes. */
export const base64urlDecode = (text: string): Uint8Array => {
	if (text.length % 4 === 1) {
		throw new CredentialsError("multibase_invalid", "bad base64url length");
	}
	const out = new Uint8Array(Math.floor((text.length * 3) / 4));
	let buffer = 0;
	let bits = 0;
	let written = 0;
	for (let index = 0; index < text.length; index++) {
		const value = BASE64URL_INDEX.get(text[index] as string);
		if (value === undefined) {
			throw new CredentialsError(
				"multibase_invalid",
				`not a base64url character at ${index}`,
			);
		}
		buffer = (buffer << 6) | value;
		bits += 6;
		if (bits >= 8) {
			bits -= 8;
			out[written++] = (buffer >> bits) & 0xff;
		}
	}
	// Leftover bits must be zero, or two strings would decode to the same bytes.
	if ((buffer & ((1 << bits) - 1)) !== 0) {
		throw new CredentialsError("multibase_invalid", "non-zero trailing bits");
	}
	return out.subarray(0, written);
};

export const multibaseBase58btc = (bytes: Uint8Array): string =>
	`z${base58btcEncode(bytes)}`;

export const multibaseBase64url = (bytes: Uint8Array): string =>
	`u${base64urlEncode(bytes)}`;

/** Decode a `z` value; any other multibase header is refused. */
export const decodeMultibaseBase58btc = (text: string): Uint8Array => {
	if (!text.startsWith("z")) {
		throw new CredentialsError(
			"multibase_invalid",
			"expected the base58btc header z",
		);
	}
	return base58btcDecode(text.slice(1));
};

/** Decode a `u` value; any other multibase header is refused. */
export const decodeMultibaseBase64url = (text: string): Uint8Array => {
	if (!text.startsWith("u")) {
		throw new CredentialsError(
			"multibase_invalid",
			"expected the base64url header u",
		);
	}
	return base64urlDecode(text.slice(1));
};
