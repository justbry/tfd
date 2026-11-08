/**
 * The demo schools' index (`schools/_demo-index.json`): each demo school in the bucket with its views' `asOf` and the
 * facts `GET /v1/schools` lists, so the list is one read and not a bucket listing plus two reads per demo school. The
 * demo seed writes it after seeding, and the views job writes it again on every run (only when it changed), so it
 * follows the bucket within one run. It names demo schools only: a real school never appears in it.
 */
import { readViewsFromStore } from "tfd/worker";
import {
	DEMO_PREFIX,
	DEMO_SCHOOL,
	type DemoBookingsFact,
	type DemoFacts,
	readDemoFacts,
} from "../demo.js";
import { schoolIdsIn } from "./school-ids.js";
import { putText, type Store, textOf } from "./store-io.js";

export const DEMO_INDEX_KEY = "schools/_demo-index.json";
const DEMO_INDEX_VERSION = 1;

export type DemoIndexEntry = { asOf: string | null } & DemoFacts &
	DemoBookingsFact;

export type DemoIndex = {
	v: typeof DEMO_INDEX_VERSION;
	/** By school id, ascending. */
	schools: Record<string, DemoIndexEntry>;
};

const isEntry = (value: unknown): value is DemoIndexEntry => {
	if (typeof value !== "object" || value === null) return false;
	const entry = value as Record<string, unknown>;
	const unit = entry.creditUnit as Record<string, unknown> | undefined;
	return (
		(entry.asOf === null || typeof entry.asOf === "string") &&
		typeof entry.name === "string" &&
		typeof entry.timeZone === "string" &&
		typeof entry.currency === "string" &&
		typeof unit?.one === "string" &&
		typeof unit.other === "string" &&
		(entry.bookingsOpenOn === null || typeof entry.bookingsOpenOn === "string")
	);
};

/** The stored index, or null when there is none or it cannot be read (the list is then worked out from the bucket). */
export const readDemoIndex = async (
	store: Store,
): Promise<DemoIndex | null> => {
	let parsed: unknown;
	try {
		const text = await textOf(store, DEMO_INDEX_KEY);
		if (text === null) return null;
		parsed = JSON.parse(text);
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) return null;
	const { v, schools } = parsed as Record<string, unknown>;
	if (
		v !== DEMO_INDEX_VERSION ||
		typeof schools !== "object" ||
		schools === null
	)
		return null;
	const entries = Object.entries(schools);
	return entries.every(([id, entry]) => DEMO_SCHOOL.test(id) && isEntry(entry))
		? { v, schools: Object.fromEntries(entries) as DemoIndex["schools"] }
		: null;
};

/** One demo school's entry, from its manifest and its stored facts. */
export const demoIndexEntryOf = async (
	store: Store,
	school: string,
): Promise<DemoIndexEntry> => {
	const [reader, facts] = await Promise.all([
		readViewsFromStore(store, school),
		readDemoFacts(store, school),
	]);
	return { asOf: reader.ok ? reader.manifest.asOf : null, ...facts };
};

/** The demo school ids in the bucket, ascending: only `schools/demo-` is listed, no other school's prefix. */
export const demoSchoolIdsIn = async (store: Store): Promise<string[]> =>
	(await schoolIdsIn(store, DEMO_PREFIX)).filter((id) => DEMO_SCHOOL.test(id));

/** Works the index out from the bucket and writes it when it changed; answers whether it wrote. */
export const refreshDemoIndex = async (store: Store): Promise<boolean> => {
	const ids = await demoSchoolIdsIn(store);
	const entries = await Promise.all(
		ids.map(async (id) => [id, await demoIndexEntryOf(store, id)] as const),
	);
	const index: DemoIndex = {
		v: DEMO_INDEX_VERSION,
		schools: Object.fromEntries(entries),
	};
	const text = `${JSON.stringify(index)}\n`;
	if ((await textOf(store, DEMO_INDEX_KEY)) === text) return false;
	await putText(store, DEMO_INDEX_KEY, text);
	return true;
};
