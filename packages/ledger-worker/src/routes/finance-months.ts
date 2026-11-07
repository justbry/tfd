/** The finance month objects a day range needs, read through the manifest-verified reader. */
import { type FinanceMonthObject, financeMonthsFor } from "atm/worker";
import { mapLimited } from "../data/concurrency.js";
import type { SchoolSnapshot } from "../data/snapshot.js";
import { viewValue } from "../data/snapshot.js";

const READ_CONCURRENCY = 6;

/** Month objects for `months`, ascending; a month the manifest does not list had no money and is left out. */
export const financeMonthObjects = async (
	snapshot: SchoolSnapshot,
	months: readonly string[],
): Promise<FinanceMonthObject[]> => {
	const reads = await mapLimited(months, READ_CONCURRENCY, (month) =>
		snapshot.reader.financeMonth(month),
	);
	const found: FinanceMonthObject[] = [];
	for (const read of reads) {
		if (!read.ok && read.error === "not-in-manifest") continue;
		found.push(viewValue(read));
	}
	return found;
};

/** The month objects an income statement over `from`..`to` reads (with the previous period's when `compare`). */
export const financeMonthsForRange = (
	snapshot: SchoolSnapshot,
	from: string,
	to: string,
	compare: boolean,
): Promise<FinanceMonthObject[]> =>
	financeMonthObjects(snapshot, financeMonthsFor(from, to, compare));
