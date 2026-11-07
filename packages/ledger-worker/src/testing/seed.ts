/** Seeds a bucket with a school's event log from a scenario preset, the way the shipper leaves it, and runs the views over it. */
import type { AtmEvent } from "atm";
import { generateScenario, resolveScenario } from "atm/scenarios";
import {
	catalogPublishedEvent,
	R2BindingStore,
	type R2BucketBinding,
	runViews,
} from "atm/worker";

export type SeededSchool = {
	id: string;
	preset: string;
	/** The views' `asOf`: the instant of the preset's last event. */
	asOf: string;
	events: AtmEvent[];
};

const encoder = new TextEncoder();

/**
 * The events of a preset, plus the `catalog.published` of its menu at the first event's instant. The events keep the
 * scenario's own `school` (the engine's catalog rows are made from it, so replay needs it); the bucket prefix is the
 * harness's school id.
 */
export const presetEvents = (preset: string): AtmEvent[] => {
	const { events, menu } = generateScenario(
		resolveScenario({ profile: preset }),
	);
	const first = events[0];
	if (first === undefined) throw new Error(`preset ${preset} has no events`);
	return [
		catalogPublishedEvent({
			school: first.school,
			menu,
			version: 1,
			eventTime: first.event_time,
		}),
		...events,
	];
};

/** One `day.jsonl` per local day under `schools/<id>/events/`. */
export const writeEvents = async (
	bucket: R2BucketBinding,
	schoolId: string,
	events: readonly AtmEvent[],
): Promise<void> => {
	const byDay = new Map<string, AtmEvent[]>();
	for (const event of events) {
		const day = byDay.get(event.date) ?? [];
		day.push(event);
		byDay.set(event.date, day);
	}
	for (const [date, day] of byDay) {
		const body = `${day.map((event) => JSON.stringify(event)).join("\n")}\n`;
		await bucket.put(
			`schools/${schoolId}/events/date=${date}/day.jsonl`,
			encoder.encode(body),
			{},
		);
	}
};

/**
 * Writes `events` as `schoolId`'s log and, unless `views` is false, runs the views as of the last event. A log that
 * cannot be replayed throws (pass `views: false` to leave that to the cron job).
 */
export const seedEvents = async (
	bucket: R2BucketBinding,
	schoolId: string,
	events: readonly AtmEvent[],
	options: { label?: string; views?: boolean } = {},
): Promise<SeededSchool> => {
	await writeEvents(bucket, schoolId, events);
	const asOf = events
		.map((event) => event.event_time)
		.sort()
		.at(-1) as string;
	if (options.views !== false) {
		const run = await runViews(
			new R2BindingStore(bucket),
			schoolId,
			new Date(asOf),
		);
		if (!run.ok)
			throw new Error(`${schoolId} cannot be replayed (${run.error.kind})`);
	}
	return {
		id: schoolId,
		preset: options.label ?? "custom",
		asOf,
		events: [...events],
	};
};

export const seedSchool = (
	bucket: R2BucketBinding,
	preset: string,
	schoolId: string,
): Promise<SeededSchool> =>
	seedEvents(bucket, schoolId, presetEvents(preset), { label: preset });
