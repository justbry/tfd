/** The school ids in the bucket: every prefix under `schools/`. */
import type { Store } from "./store-io.js";

const SCHOOLS_PREFIX = "schools/";
const TRAILING_SLASH = /\/$/;

/** Every school id with a prefix under `schools/` (and starting with `startsWith`: only those are listed), ascending. */
export const schoolIdsIn = async (
	store: Store,
	startsWith = "",
): Promise<string[]> => {
	const ids: string[] = [];
	let cursor: string | undefined;
	for (;;) {
		const page = await store.list({
			prefix: `${SCHOOLS_PREFIX}${startsWith}`,
			delimiter: "/",
			cursor,
		});
		for (const prefix of page.prefixes)
			ids.push(prefix.slice(SCHOOLS_PREFIX.length).replace(TRAILING_SLASH, ""));
		if (page.next === null) break;
		cursor = page.next;
	}
	return ids.sort();
};
