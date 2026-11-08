/**
 * The ship watermark: what the buzz-school shipper writes after each run, `{ school, env, shippedThrough }`, the instant
 * up to which a school's events have reached the bucket. The views job stamps a generation's `asOf` with no later than it,
 * so the UI's "pending until `asOf` passes" cannot clear a write that has not shipped.
 */
import { type Store, textOf } from "./store-io.js";

/** Where the shipper leaves it. One constant, because the spec may still move it (e.g. `schools/<id>/ship-watermark.json`). */
export const watermarkKey = (school: string): string =>
	`schools/${school}/events/_shipped-through.json`;

/** The instant the school's events are shipped through, or null: no object, not JSON, not this school's, or no instant. */
export const readShippedThrough = async (
	store: Store,
	school: string,
): Promise<number | null> => {
	const text = await textOf(store, watermarkKey(school));
	if (text === null) return null;
	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		return null;
	}
	if (typeof body !== "object" || body === null) return null;
	const { school: named, shippedThrough } = body as Record<string, unknown>;
	if (named !== undefined && named !== school) return null;
	if (typeof shippedThrough !== "string") return null;
	const instant = Date.parse(shippedThrough);
	return Number.isNaN(instant) ? null : instant;
};

/**
 * The `asOf` for a run scheduled at `scheduled`: the earlier of that and the watermark. A missing, unreadable or
 * future-dated watermark never raises it above the scheduled time (without a watermark, `asOf` can run ahead of
 * unshipped events).
 */
export const asOfFor = async (
	store: Store,
	school: string,
	scheduled: Date,
): Promise<Date> => {
	const shipped = await readShippedThrough(store, school);
	return shipped === null || shipped >= scheduled.getTime()
		? scheduled
		: new Date(shipped);
};
