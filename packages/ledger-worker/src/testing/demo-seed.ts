/**
 * The demo schools' seed (`demo.ts`): each of atm's fifteen school presets (the mart presets) as `schools/demo-<preset>/`,
 * its events in the shipper's batch files (`planOutbox`, one `batch-*.jsonl` per local day) and its display facts in
 * `demo.json`. A rerun replaces those objects and touches nothing outside the demo prefixes; the views are then built as
 * of `now`. Used by `scripts/seed-demo.ts` (the staging bucket) and the test harness.
 */
import { createHash } from "node:crypto";
import { type AtmEvent, planOutbox, type Store } from "tfd";
import { runViews } from "tfd/worker";
import { latestMenu } from "../data/menu.js";
import { putText, textOf } from "../data/store-io.js";
import {
	DEMO_PREFIX,
	type DemoFacts,
	demoFactsKey,
	demoNameOf,
} from "../demo.js";
import { presetEvents } from "./seed.js";

/** atm's school presets (`PROFILES` without an `org`): the studio, church, SaaS, creator and ad hoc ones are not demos. */
export const DEMO_PRESETS = [
	"annual-prepay",
	"child-only",
	"churn-spike",
	"disputes",
	"fee-oracle",
	"free-only",
	"growth-12mo",
	"heavy-refunds",
	"monthly-members",
	"non-usd",
	"one-payer-tier",
	"seminar-quantities",
	"single-refund-month",
	"tiny-school",
	"yearly-solo",
] as const;

export const demoSchoolIdOf = (preset: string): string =>
	`${DEMO_PREFIX}${preset}`;

const encoder = new TextEncoder();
/** Puts at once: a year of daily batches one by one over the S3 API takes minutes per school. */
const PUT_CONCURRENCY = 16;

const inParallel = async <Item>(
	items: readonly Item[],
	work: (item: Item) => Promise<void>,
): Promise<void> => {
	let next = 0;
	const worker = async (): Promise<void> => {
		while (next < items.length) {
			const item = items[next] as Item;
			next += 1;
			await work(item);
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(PUT_CONCURRENCY, items.length) }, worker),
	);
};

const sha256Of = (body: Uint8Array): string =>
	createHash("sha256").update(body).digest("hex");

export type DemoSeedReport = {
	school: string;
	/** Batch files put (new or changed). */
	written: number;
	/** Batch files already holding these bytes. */
	unchanged: number;
	/** Event objects of an earlier seed this one no longer produces, deleted. */
	removed: number;
	/** The views' `asOf`, or null when `views` was false. */
	viewsAsOf: string | null;
};

/** The facts `GET /v1/schools` lists for the preset: its latest `catalog.published`, else the plain labels. */
export const demoFactsOf = (
	preset: string,
	events: readonly AtmEvent[] = presetEvents(preset),
): DemoFacts => {
	const menu = latestMenu(events);
	return {
		name: demoNameOf(demoSchoolIdOf(preset)),
		timeZone: menu?.timeZone ?? "America/Denver",
		currency: (menu?.currency ?? "usd").toUpperCase(),
		creditUnit: menu?.unit ?? { one: "credit", other: "credits" },
	};
};

const keysUnder = async (store: Store, prefix: string): Promise<string[]> => {
	const keys: string[] = [];
	let cursor: string | undefined;
	for (;;) {
		const page = await store.list({ prefix, cursor });
		keys.push(...page.objects.map((object) => object.key));
		if (page.next === null) return keys;
		cursor = page.next;
	}
};

/**
 * Writes one preset as `demo-<preset>`: the batches it produces (a batch key carries the hash of its bytes, so one that
 * exists already holds them), then deletes every other object under its `events/`, then `demo.json`, then (unless
 * `views` is false) runs the views as of `now`. Refuses a preset that is not a school preset.
 */
export const seedDemoSchool = async (
	store: Store,
	preset: string,
	options: { now: Date; views?: boolean; events?: readonly AtmEvent[] },
): Promise<DemoSeedReport> => {
	if (!(DEMO_PRESETS as readonly string[]).includes(preset))
		throw new Error(`${preset} is not one of the demo school presets`);
	const school = demoSchoolIdOf(preset);
	const events = options.events ?? presetEvents(preset);
	const batches = planOutbox({
		school,
		rows: events.map((event) => ({
			id: event.id,
			idem: event.idem,
			date: event.date,
			body: JSON.stringify(event),
		})),
	});
	const eventsPrefix = `schools/${school}/events/`;
	const existing = new Set(await keysUnder(store, eventsPrefix));
	const report: DemoSeedReport = {
		school,
		written: 0,
		unchanged: 0,
		removed: 0,
		viewsAsOf: null,
	};
	const missing = batches.filter((batch) => {
		if (!batch.key.startsWith(eventsPrefix))
			throw new Error(`batch ${batch.key} is outside ${eventsPrefix}`);
		return !existing.has(batch.key);
	});
	report.unchanged = batches.length - missing.length;
	// A batch key carries the hash of its bytes, so a create-only put that finds the key has nothing to write.
	await inParallel(missing, async (batch) => {
		try {
			await store.putIfAbsent(batch.key, encoder.encode(batch.text));
		} catch (error) {
			if (!(error instanceof Error && error.name === "AlreadyExists"))
				throw error;
		}
		report.written += 1;
	});
	const wanted = new Set(batches.map((batch) => batch.key));
	for (const key of existing) {
		if (wanted.has(key)) continue;
		const stored = await store.get(key);
		await store.delete(key, sha256Of(stored.body));
		report.removed += 1;
	}
	const facts = `${JSON.stringify(demoFactsOf(preset, events))}\n`;
	if ((await textOf(store, demoFactsKey(school))) !== facts)
		await putText(store, demoFactsKey(school), facts);
	if (options.views !== false) {
		const run = await runViews(store, school, options.now);
		if (!run.ok)
			throw new Error(`${school} cannot be replayed (${run.error.kind})`);
		report.viewsAsOf = run.views.asOf;
	}
	return report;
};
