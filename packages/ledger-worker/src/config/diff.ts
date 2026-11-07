/** What a write would change: one entry for each leaf that is added, removed or different, by path (`promos[0].value`). */

export type DiffEntry = {
	path: string;
	change: "added" | "removed" | "changed";
	before?: unknown;
	after?: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const walk = (
	before: unknown,
	after: unknown,
	path: string,
	into: DiffEntry[],
): void => {
	if (isRecord(before) && isRecord(after)) {
		const keys = [
			...new Set([...Object.keys(before), ...Object.keys(after)]),
		].sort();
		for (const key of keys) {
			const at = path === "" ? key : `${path}.${key}`;
			if (!Object.hasOwn(after, key))
				into.push({ path: at, change: "removed", before: before[key] });
			else if (!Object.hasOwn(before, key))
				into.push({ path: at, change: "added", after: after[key] });
			else walk(before[key], after[key], at, into);
		}
		return;
	}
	if (Array.isArray(before) && Array.isArray(after)) {
		const length = Math.max(before.length, after.length);
		for (let index = 0; index < length; index += 1) {
			const at = `${path}[${index}]`;
			if (index >= after.length)
				into.push({ path: at, change: "removed", before: before[index] });
			else if (index >= before.length)
				into.push({ path: at, change: "added", after: after[index] });
			else walk(before[index], after[index], at, into);
		}
		return;
	}
	if (JSON.stringify(before) !== JSON.stringify(after))
		into.push({ path, change: "changed", before, after });
};

/** `before` is null when the object does not exist yet: every leaf of `after` is then added. */
export const diffOf = (before: unknown, after: unknown): DiffEntry[] => {
	const entries: DiffEntry[] = [];
	if (before === null) walk({}, after, "", entries);
	else walk(before, after, "", entries);
	return entries;
};
