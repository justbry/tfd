/**
 * Where a demo school's route answers (`route-answers.ts`) live: `schools/<id>/demo-api/<route>.json`, beside
 * `demo-api/not-available.json` (each route the events cannot answer, and why) and the school's `demo.json` (its facts
 * and the local date of its latest booking). The answers are worked out as of the instant its views are built, from the
 * same events (`eventsAsOf`), so its Members and Bookings agree with its books. The seed writes them; the views job
 * writes them again whenever it rebuilds the demo school's views.
 */
import type { AtmEvent } from "tfd";
import { eventsAsOf } from "tfd/worker";
import { putText, type Store, textOf } from "../data/store-io.js";
import { type DemoFacts, demoFactsKey } from "../demo.js";
import { demoRouteAnswers } from "./route-answers.js";

export const demoApiPrefix = (school: string): string =>
	`schools/${school}/demo-api/`;
export const demoApiKey = (school: string, route: string): string =>
	`${demoApiPrefix(school)}${route}.json`;
/** The routes a demo school cannot answer: `{ "<route>": "<why>" }`. */
export const DEMO_NOT_AVAILABLE = "not-available";

export type DemoApiReport = {
	written: number;
	unchanged: number;
	removed: number;
};

const sha256Of = async (body: Uint8Array): Promise<string> =>
	[...new Uint8Array(await crypto.subtle.digest("SHA-256", body))]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");

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
 * Writes `school`'s answers as of `asOf` from its `events`, each object only when its bytes change, and deletes every
 * other object under its `demo-api/`; then its `demo.json` with `bookingsOpenOn`. Touches nothing outside the school's
 * `demo-api/` and `demo.json`.
 */
export const writeDemoApi = async (
	store: Store,
	school: string,
	events: readonly AtmEvent[],
	facts: DemoFacts,
	asOf: Date,
): Promise<DemoApiReport> => {
	const { answers, notAvailable, lastBookingOn } = demoRouteAnswers(
		school,
		eventsAsOf(events, asOf),
		facts,
	);
	const wanted = new Map<string, string>();
	for (const [route, answer] of answers)
		wanted.set(demoApiKey(school, route), `${JSON.stringify(answer)}\n`);
	wanted.set(
		demoApiKey(school, DEMO_NOT_AVAILABLE),
		`${JSON.stringify(Object.fromEntries(notAvailable))}\n`,
	);
	const report: DemoApiReport = { written: 0, unchanged: 0, removed: 0 };
	// A handful of objects: all at once, as the seed puts its batches.
	await Promise.all(
		[...wanted].map(async ([key, text]) => {
			if ((await textOf(store, key)) === text) report.unchanged += 1;
			else {
				await putText(store, key, text);
				report.written += 1;
			}
		}),
	);
	const stale = (await keysUnder(store, demoApiPrefix(school))).filter(
		(key) => !wanted.has(key),
	);
	await Promise.all(
		stale.map(async (key) => {
			const stored = await store.get(key);
			await store.delete(key, await sha256Of(stored.body));
			report.removed += 1;
		}),
	);
	const factsText = `${JSON.stringify({ ...facts, bookingsOpenOn: lastBookingOn })}\n`;
	if ((await textOf(store, demoFactsKey(school))) !== factsText)
		await putText(store, demoFactsKey(school), factsText);
	return report;
};
