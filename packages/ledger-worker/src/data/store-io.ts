import type { Store } from "atm";

export type { Store } from "atm";

const decoder = new TextDecoder();
const encoder = new TextEncoder();
const NOT_FOUND = "NotFound";

const isNotFound = (error: unknown): boolean =>
	error instanceof Error && error.name === NOT_FOUND;

/** The object's text, or null when the key is not there. */
export const textOf = async (
	store: Store,
	key: string,
): Promise<string | null> => {
	try {
		return decoder.decode((await store.get(key)).body);
	} catch (error) {
		if (isNotFound(error)) return null;
		throw error;
	}
};

/** Writes `text` at `key`, replacing what is there. */
export const putText = async (
	store: Store,
	key: string,
	text: string,
): Promise<void> => {
	const body = encoder.encode(text);
	let etag: string | null = null;
	try {
		etag = (await store.head(key)).etag;
	} catch (error) {
		if (!isNotFound(error)) throw error;
	}
	if (etag === null) await store.putIfAbsent(key, body);
	else await store.putIfMatch(key, body, etag);
};
