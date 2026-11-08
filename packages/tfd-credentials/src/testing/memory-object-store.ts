/**
 * An in-memory `ObjectStore` that throws errors named like atm's store errors (NotFound, AlreadyExists, Stale), for
 * testing the object-store adapters without a bucket.
 */
import { sha256Bytes, toHex } from "../bytes.js";
import type { ObjectStore } from "../object-store.js";

const namedError = (name: string, message: string): Error => {
	const error = new Error(message);
	error.name = name;
	return error;
};

const PAGE_SIZE = 2;

export const memoryObjectStore = (): ObjectStore => {
	const objects = new Map<string, Uint8Array>();
	const etagOf = (body: Uint8Array): string => `"${toHex(sha256Bytes(body))}"`;
	return {
		get: async (key) => {
			const body = objects.get(key);
			if (body === undefined)
				throw namedError("NotFound", `${key} does not exist`);
			return { body: body.slice(), etag: etagOf(body) };
		},
		putIfAbsent: async (key, body) => {
			if (objects.has(key))
				throw namedError("AlreadyExists", `${key} already exists`);
			objects.set(key, body.slice());
			return { etag: etagOf(body) };
		},
		putIfMatch: async (key, body, etag) => {
			const current = objects.get(key);
			if (current === undefined)
				throw namedError("NotFound", `${key} does not exist`);
			if (etagOf(current) !== etag) throw namedError("Stale", `${key} changed`);
			objects.set(key, body.slice());
			return { etag: etagOf(body) };
		},
		// Small pages, so adapters are exercised across `next` cursors.
		list: async (options = {}) => {
			const keys = [...objects.keys()]
				.filter((key) => key.startsWith(options.prefix ?? ""))
				.sort();
			const start =
				options.cursor === undefined ? 0 : keys.indexOf(options.cursor) + 1;
			const page = keys.slice(start, start + PAGE_SIZE);
			const last = page.at(-1);
			const next =
				start + PAGE_SIZE < keys.length && last !== undefined ? last : null;
			return { objects: page.map((key) => ({ key })), next };
		},
	};
};
