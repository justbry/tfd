/** `GET /v1/schools`: how fresh each of the token's schools' views are, then the demo schools in the bucket. */
import { readViewsFromStore } from "tfd/worker";
import type { Store } from "../data/store-io.js";
import {
	DEMO_SCHOOL,
	type DemoBookingsFact,
	type DemoFacts,
	readDemoFacts,
} from "../demo.js";
import { lagMinutesOf } from "../http.js";
import { schoolIdsIn } from "../views-job.js";

/** A school whose views are older than this is stale. */
export const STALE_AFTER_MINUTES = 15;

export type SchoolFreshness = {
	id: string;
	asOf: string | null;
	lagMinutes: number | null;
	stale: boolean;
};

/** A demo school's row: its freshness, `demo: true`, the facts buzz-school has none of and the day its Bookings tab
 * opens on. */
export type DemoSchoolRow = SchoolFreshness & { demo: true } & DemoFacts &
	DemoBookingsFact;

/** The views' `asOf` and lag, or nulls when the school has no views yet. */
export const freshnessOf = async (
	store: Store,
	id: string,
	now: number,
): Promise<{ asOf: string | null; lagMinutes: number | null }> => {
	const reader = await readViewsFromStore(store, id);
	if (!reader.ok) return { asOf: null, lagMinutes: null };
	const { asOf } = reader.manifest;
	return { asOf, lagMinutes: lagMinutesOf(asOf, now) };
};

export const schoolsRoute = async (
	store: Store,
	ids: readonly string[],
	now: number,
): Promise<SchoolFreshness[]> =>
	Promise.all(
		ids.map(async (id): Promise<SchoolFreshness> => {
			const { asOf, lagMinutes } = await freshnessOf(store, id, now);
			return {
				id,
				asOf,
				lagMinutes,
				stale: lagMinutes === null || lagMinutes > STALE_AFTER_MINUTES,
			};
		}),
	);

/**
 * Every demo school with a prefix in the bucket, ascending, but those in `listed` (the token's). Never stale: nothing
 * ships to a demo school, and the views job rebuilds its views at its own pace (`views-job.ts`).
 */
export const demoSchoolsRoute = async (
	store: Store,
	listed: ReadonlySet<string>,
	now: number,
): Promise<DemoSchoolRow[]> => {
	const ids = (await schoolIdsIn(store)).filter(
		(id) => DEMO_SCHOOL.test(id) && !listed.has(id),
	);
	return Promise.all(
		ids.map(async (id): Promise<DemoSchoolRow> => {
			const [freshness, facts] = await Promise.all([
				freshnessOf(store, id, now),
				readDemoFacts(store, id),
			]);
			return { id, ...freshness, stale: false, demo: true, ...facts };
		}),
	);
};
