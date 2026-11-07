/** `GET /v1/schools`: how fresh each of the token's schools' views are. */
import { readViewsFromStore } from "atm/worker";
import type { Store } from "../data/store-io.js";
import { lagMinutesOf } from "../http.js";

/** A school whose views are older than this is stale. */
export const STALE_AFTER_MINUTES = 15;

export type SchoolFreshness = {
	id: string;
	asOf: string | null;
	lagMinutes: number | null;
	stale: boolean;
};

export const schoolsRoute = async (
	store: Store,
	ids: readonly string[],
	now: number,
): Promise<SchoolFreshness[]> =>
	Promise.all(
		ids.map(async (id): Promise<SchoolFreshness> => {
			const reader = await readViewsFromStore(store, id);
			if (!reader.ok) return { id, asOf: null, lagMinutes: null, stale: true };
			const { asOf } = reader.manifest;
			const lagMinutes = lagMinutesOf(asOf, now);
			return { id, asOf, lagMinutes, stale: lagMinutes > STALE_AFTER_MINUTES };
		}),
	);
