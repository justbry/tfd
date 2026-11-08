/**
 * `GET /v1/schools`: how fresh each of the token's schools' views are (each one's manifest: the token lists few, and
 * they are read at once), then the demo schools in the bucket (the demo index, one read; the bucket when it has none).
 */
import { readViewsFromStore } from "tfd/worker";
import {
	demoIndexEntryOf,
	demoSchoolIdsIn,
	readDemoIndex,
} from "../data/demo-index.js";
import type { Store } from "../data/store-io.js";
import type { DemoBookingsFact, DemoFacts } from "../demo.js";
import { lagMinutesOf } from "../http.js";

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
 * ships to a demo school, and the views job rebuilds its views at its own pace (`views-job.ts`). From the demo index
 * (`data/demo-index.ts`) when there is one, else from the bucket: the same rows either way.
 */
export const demoSchoolsRoute = async (
	store: Store,
	listed: ReadonlySet<string>,
	now: number,
): Promise<DemoSchoolRow[]> => {
	const index = await readDemoIndex(store);
	const entries =
		index === null
			? await Promise.all(
					(await demoSchoolIdsIn(store)).map(
						async (id) => [id, await demoIndexEntryOf(store, id)] as const,
					),
				)
			: Object.entries(index.schools).sort(([a], [b]) =>
					a < b ? -1 : a > b ? 1 : 0,
				);
	return entries
		.filter(([id]) => !listed.has(id))
		.map(
			([id, { asOf, ...facts }]): DemoSchoolRow => ({
				id,
				asOf,
				lagMinutes: asOf === null ? null : lagMinutesOf(asOf, now),
				stale: false,
				demo: true,
				...facts,
			}),
		);
};
