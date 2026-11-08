/**
 * The stored answers (`data/answers.ts`) on both sides: the views job works them out with the endpoints' own functions,
 * and a request reads the one it asks for, from the isolate, the data centre's cache (`caches.default`) or R2, in that
 * order.
 *
 * The cache key is the school, the generation, the day and the answer's name (`kpi/<audience>-<pin>`,
 * `disclosure/<adminAudience>`), never the caller: an answer holds what its audience may see, and the Worker has checked
 * that this caller may see that audience before it builds the key. The key holds the generation, so an entry never goes
 * stale; the envelope (`asOf`, `lagMinutes`) is not cached but written around the data at request time.
 */
import type { AtmEvent } from "tfd";
import {
	ANSWER_NAMES,
	ANSWERS_VERSION,
	type AnswersPointer,
	localDayOf,
	type OpenedGeneration,
	readStoredAnswers,
	type WriteAnswersOutcome,
	writeAnswers,
} from "../data/answers.js";
import { openSnapshot } from "../data/snapshot.js";
import type { Store } from "../data/store-io.js";
import type { Timing } from "../timing.js";
import { disclosureRoute, kpiRoute, zoneOf } from "./kpi.js";

/** What the Worker needs of `caches.default`. */
export type AnswersCache = {
	match(key: string): Promise<Response | undefined>;
	put(key: string, response: Response): Promise<void>;
};

/** `ctx.waitUntil` of the fetch handler: the cache is filled after the answer has gone. */
export type WaitUntil = (promise: Promise<unknown>) => void;

const KEPT_BUNDLES = 16;
/** A cache entry's lifetime: its key names the generation, so it is never wrong, only unused once a newer one exists. */
const CACHED_SECONDS = 86_400;
const CACHE_PATH = "/v1/__stored-answers";

/** Works out every stored answer of the school's current generation, as the endpoints would at `now`. */
export const computeAnswers = async (
	store: Store,
	school: string,
	opened: OpenedGeneration,
	now: number,
	events?: readonly AtmEvent[],
) => {
	const snapshot = await openSnapshot(store, school, {
		opened,
		...(events === undefined ? {} : { events }),
	});
	const answers = new Map<string, string>();
	for (const { name, kind, audience, pinLocked } of ANSWER_NAMES)
		answers.set(
			name,
			JSON.stringify(
				kind === "kpi"
					? await kpiRoute(snapshot, audience, pinLocked, now)
					: await disclosureRoute(snapshot, now, audience),
			),
		);
	return {
		zone: await zoneOf(snapshot),
		events: await snapshot.events(),
		answers,
	};
};

/**
 * Stores the answers of the school's current views for the local day of `now` (the views job, after a run; the demo
 * seed). `events` is the whole log when the caller has just read it.
 */
export const storeAnswers = (
	store: Store,
	school: string,
	now: Date,
	events?: readonly AtmEvent[],
): Promise<WriteAnswersOutcome> =>
	writeAnswers(store, school, now, (opened) =>
		computeAnswers(store, school, opened, now.getTime(), events),
	);

/** The pointer, when it holds for a request at `now`: same generation as the manifest, and the same local day. */
export const pointerFor = (
	opened: OpenedGeneration,
	now: number,
): AnswersPointer | null => {
	const { pointer } = opened;
	return pointer !== null && localDayOf(now, pointer.zone) === pointer.day
		? pointer
		: null;
};

const bundles = new Map<string, Promise<Map<string, string> | null>>();

/** Forgets the isolate's stored answers (tests). */
export const forgetStoredAnswers = (): void => bundles.clear();

const cacheKeyOf = (
	origin: string,
	school: string,
	pointer: AnswersPointer,
	name: string,
): string =>
	`${origin}${CACHE_PATH}/v${ANSWERS_VERSION}/${encodeURIComponent(school)}/${pointer.generation}/${pointer.day}/${name}`;

const cachedCopy = (data: string): Response =>
	new Response(data, {
		headers: {
			"content-type": "application/json; charset=utf-8",
			"cache-control": `public, max-age=${CACHED_SECONDS}`,
		},
	});

/**
 * The stored data of answer `name` (its JSON text), or null when the generation has none: the isolate's copy, else the
 * cache, else the answers object in R2 (one read for every answer of the generation, kept in the isolate, and each of
 * them put in the cache).
 */
export const storedAnswer = async (input: {
	store: Store;
	school: string;
	pointer: AnswersPointer;
	name: string;
	origin: string;
	cache: AnswersCache | null;
	waitUntil: WaitUntil;
	/** Told when the isolate's copy serves the answer, so the Cache API is not asked. */
	timing?: Timing;
}): Promise<string | null> => {
	const { store, school, pointer, name, origin, cache, waitUntil } = input;
	const memoKey = `${school}|${pointer.generation}|${pointer.day}`;
	const kept = bundles.get(memoKey);
	if (kept !== undefined) {
		input.timing?.note("cache", "isolate");
		return (await kept)?.get(name) ?? null;
	}
	if (cache !== null) {
		const hit = await cache
			.match(cacheKeyOf(origin, school, pointer, name))
			.catch(() => undefined);
		if (hit !== undefined) return hit.text();
	}
	let read = bundles.get(memoKey);
	if (read === undefined) {
		read = readStoredAnswers(store, school, pointer);
		bundles.set(memoKey, read);
		// a failed or missing read is not kept: the next request reads again
		read.then(
			(answers) => {
				if (answers === null) bundles.delete(memoKey);
				else if (cache !== null)
					waitUntil(
						Promise.all(
							[...answers].map(([each, data]) =>
								cache.put(
									cacheKeyOf(origin, school, pointer, each),
									cachedCopy(data),
								),
							),
						).catch(() => undefined),
					);
			},
			() => bundles.delete(memoKey),
		);
		while (bundles.size > KEPT_BUNDLES) {
			const oldest = bundles.keys().next().value;
			if (oldest === undefined) break;
			bundles.delete(oldest);
		}
	}
	try {
		return (await read)?.get(name) ?? null;
	} catch {
		// R2 failed on the answers: the endpoint computes, and says so if R2 fails it too
		return null;
	}
};
