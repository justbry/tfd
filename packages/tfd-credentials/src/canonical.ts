/**
 * RFC 8785 JSON Canonicalization Scheme (https://www.rfc-editor.org/rfc/rfc8785). ECMAScript's own primitive
 * serialisation is the one JCS specifies (§3.2.2), so strings and numbers go through `JSON.stringify`; what this adds
 * is the strictness JCS demands and `JSON.stringify` lacks:
 *
 * - Object keys sorted by UTF-16 code units (§3.2.3), and emitted in that order. `Object.fromEntries` cannot carry
 *   the order: integer-like keys ("1", "10") are always enumerated first, in numeric order.
 * - NaN and Infinity throw (§3.2.2.3) instead of becoming `null`.
 * - A lone surrogate throws (§3.2.2.2 note) instead of becoming `\udxxx`.
 * - Only plain JSON data: no `toJSON`, Date, Map, bigint, function or symbol, and no `undefined` inside an array.
 *   An `undefined` object member is skipped, as `JSON.stringify` skips it, so the bytes hashed are the bytes stored.
 */
import { isWellFormed, utf8 } from "./bytes.js";
import { CredentialsError } from "./errors.js";

export type JsonValue =
	| null
	| boolean
	| number
	| string
	| JsonValue[]
	| { [key: string]: JsonValue };

const fail = (path: string, message: string): never => {
	throw new CredentialsError("canonical_invalid", `${path || "$"}: ${message}`);
};

const serializeString = (value: string, path: string): string => {
	if (!isWellFormed(value)) fail(path, "lone surrogate");
	return JSON.stringify(value);
};

const isPlainObject = (value: object): boolean => {
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
};

const compareCodeUnits = (left: string, right: string): number => {
	// String comparison with < is by UTF-16 code unit, independent of locale (RFC 8785 §3.2.3).
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
};

const serialize = (value: unknown, path: string): string => {
	if (value === null) return "null";
	switch (typeof value) {
		case "boolean":
			return value ? "true" : "false";
		case "number":
			if (!Number.isFinite(value)) fail(path, "NaN or Infinity");
			return JSON.stringify(value);
		case "string":
			return serializeString(value, path);
		case "object":
			break;
		default:
			return fail(path, `${typeof value} is not JSON`);
	}
	if (Array.isArray(value)) {
		const items: string[] = [];
		for (const [index, item] of value.entries()) {
			if (item === undefined) fail(`${path}[${index}]`, "undefined in array");
			items.push(serialize(item, `${path}[${index}]`));
		}
		return `[${items.join(",")}]`;
	}
	const object = value as object;
	if (!isPlainObject(object)) fail(path, "not a plain object");
	const record = object as Record<string, unknown>;
	const keys = Object.keys(record).sort(compareCodeUnits);
	const members: string[] = [];
	for (const key of keys) {
		const member = record[key];
		if (member === undefined) continue;
		const memberPath = path ? `${path}.${key}` : key;
		members.push(
			`${serializeString(key, memberPath)}:${serialize(member, memberPath)}`,
		);
	}
	return `{${members.join(",")}}`;
};

/** The RFC 8785 canonical text of a JSON value. Throws `CredentialsError("canonical_invalid")`. */
export const canonicalize = (value: unknown): string => serialize(value, "");

/** The canonical text as UTF-8 bytes (RFC 8785 §3.2.4), the form that is hashed and signed. */
export const canonicalBytes = (value: unknown): Uint8Array =>
	utf8(canonicalize(value));
