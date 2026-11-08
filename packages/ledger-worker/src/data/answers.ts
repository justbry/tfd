/**
 * A views generation's finished answers, written beside the views so a cold isolate answers without opening the log
 * (contract section 11, "Stored answers"). Three objects under `schools/<id>/views/answers/`:
 *
 * - `log.jsonl`: the events up to the generation's `asOf`, one object instead of the shipper's day files. A header line
 *   names the hash of the event lines. Rewritten only when those lines change.
 * - `answers.jsonl`: a header line naming the generation and the school-local day, then one line per answer,
 *   `<name>\t<data JSON>`: `disclosure/<adminAudience>` for every audience, `kpi/<audience>-open` for every audience
 *   and `kpi/<audience>-locked` from governance up (below it `locked` is `open`). One object, so a generation costs two
 *   writes and not fourteen.
 * - `current.json`: the pointer, written last: the generation, its `asOf`, the school's time zone, the day the answers
 *   were worked out on and the hash of the log lines.
 *
 * A reader trusts none of it alone: the pointer counts only when its generation is the manifest's (`openGeneration`
 * reads both at once), the answers only when their header names that generation and day, and the log only when its
 * header names the pointer's hash. Anything else is a miss, and the endpoint computes as it did before.
 *
 * The answers depend on the request's time only through the school's local day (`clockOf`), so they hold for every
 * request on `day`; on another day the endpoint computes.
 */
import type { AtmEvent } from "tfd";
import {
	readViewsFromStore,
	type ViewReadError,
	type ViewsReader,
} from "tfd/worker";
import { type Audience, audiences } from "../auth/claims.js";
import { localWallTime } from "../time.js";
import { putText, type Store, textOf } from "./store-io.js";

/** Bump when an answer's shape or the way it is worked out changes: older stored answers are then misses. */
export const ANSWERS_VERSION = 1;
const GENERATION_HEX = 20;
const SEPARATOR = "\t";
const PIN_FROM: Audience = "governance";

export const answersPrefix = (school: string): string =>
	`schools/${school}/views/answers/`;
export const answersPointerKey = (school: string): string =>
	`${answersPrefix(school)}current.json`;
export const answersBundleKey = (school: string): string =>
	`${answersPrefix(school)}answers.jsonl`;
export const answersLogKey = (school: string): string =>
	`${answersPrefix(school)}log.jsonl`;

export type AnswersPointer = {
	v: typeof ANSWERS_VERSION;
	generation: string;
	asOf: string;
	/** The school's time zone (`zoneOf`): the request's local day is worked out in it. */
	zone: string;
	/** The school-local day the answers hold for. */
	day: string;
	/** The SHA-256 of the log's event lines. */
	log: string;
};

/** The manifest and the pointer, read at once; `pointer` is null unless it names the manifest's generation. */
export type OpenedGeneration = {
	reader: ViewsReader | ViewReadError;
	generation: string | null;
	pointer: AnswersPointer | null;
};

const encoder = new TextEncoder();

const sha256Hex = async (text: string): Promise<string> =>
	[
		...new Uint8Array(
			await crypto.subtle.digest("SHA-256", encoder.encode(text)),
		),
	]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");

/** A generation's id: the snapshot's identity (`asOf` and the log it was built from), hashed short. */
export const generationOf = async (
	manifest: ViewsReader["manifest"],
): Promise<string> =>
	(
		await sha256Hex(
			JSON.stringify([
				manifest.asOf,
				manifest.generatedFrom.lastEventId,
				manifest.generatedFrom.eventCount,
			]),
		)
	).slice(0, GENERATION_HEX);

/** The school-local day of `now` in `zone`. */
export const localDayOf = (now: number, zone: string): string =>
	localWallTime(now, zone).slice(0, 10);

/** Whether the PIN state means anything at this audience: it locks the books from governance up. */
export const pinLockedOf = (audience: Audience, pin: string | null): boolean =>
	pin === "locked" &&
	audiences.indexOf(audience) >= audiences.indexOf(PIN_FROM);

export const kpiAnswerName = (audience: Audience, pinLocked: boolean): string =>
	`kpi/${audience}-${pinLocked ? "locked" : "open"}`;
export const disclosureAnswerName = (adminAudience: Audience): string =>
	`disclosure/${adminAudience}`;

/** Every answer a generation stores, by name: what `computeAnswer` is asked for. */
export const ANSWER_NAMES: readonly {
	name: string;
	kind: "kpi" | "disclosure";
	audience: Audience;
	pinLocked: boolean;
}[] = audiences.flatMap((audience) => [
	{
		name: disclosureAnswerName(audience),
		kind: "disclosure" as const,
		audience,
		pinLocked: false,
	},
	...[false, true]
		.filter((locked) => !locked || pinLockedOf(audience, "locked"))
		.map((pinLocked) => ({
			name: kpiAnswerName(audience, pinLocked),
			kind: "kpi" as const,
			audience,
			pinLocked,
		})),
]);

const isPointer = (value: unknown): value is AnswersPointer => {
	if (typeof value !== "object" || value === null) return false;
	const { v, generation, asOf, zone, day, log } = value as Record<
		string,
		unknown
	>;
	return (
		v === ANSWERS_VERSION &&
		[generation, asOf, zone, day, log].every(
			(field) => typeof field === "string" && field !== "",
		)
	);
};

/** The stored pointer, or null: none, unreadable, another version, or a read that failed (the endpoint computes). */
export const readPointer = async (
	store: Store,
	school: string,
): Promise<AnswersPointer | null> => {
	try {
		const text = await textOf(store, answersPointerKey(school));
		if (text === null) return null;
		const parsed: unknown = JSON.parse(text);
		return isPointer(parsed) ? parsed : null;
	} catch {
		return null;
	}
};

/** Reads the manifest and the pointer at once: one round trip to R2. */
export const openGeneration = async (
	store: Store,
	school: string,
): Promise<OpenedGeneration> => {
	const [reader, pointer] = await Promise.all([
		readViewsFromStore(store, school),
		readPointer(store, school),
	]);
	const generation = reader.ok ? await generationOf(reader.manifest) : null;
	return {
		reader,
		generation,
		pointer:
			pointer !== null &&
			generation !== null &&
			pointer.generation === generation
				? pointer
				: null,
	};
};

// ---- The log

type LogHeader = { v: typeof ANSWERS_VERSION; events: string };

const eventLinesOf = (events: readonly AtmEvent[]): string =>
	events.map((event) => `${JSON.stringify(event)}\n`).join("");

/** The stored log the pointer names, or null when it is missing or another one (being rewritten). */
export const readStoredLog = async (
	store: Store,
	school: string,
	pointer: AnswersPointer,
): Promise<AtmEvent[] | null> => {
	const text = await textOf(store, answersLogKey(school));
	if (text === null) return null;
	const end = text.indexOf("\n");
	if (end < 0) return null;
	let header: Partial<LogHeader>;
	try {
		header = JSON.parse(text.slice(0, end)) as Partial<LogHeader>;
	} catch {
		return null;
	}
	if (header.v !== ANSWERS_VERSION || header.events !== pointer.log)
		return null;
	const events: AtmEvent[] = [];
	for (const line of text.slice(end + 1).split("\n"))
		if (line !== "") events.push(JSON.parse(line) as AtmEvent);
	return events;
};

// ---- The answers

type BundleHeader = {
	v: typeof ANSWERS_VERSION;
	generation: string;
	day: string;
};

/** The stored answers of the pointer's generation and day by name, or null when the object holds another one. */
export const readStoredAnswers = async (
	store: Store,
	school: string,
	pointer: AnswersPointer,
): Promise<Map<string, string> | null> => {
	const text = await textOf(store, answersBundleKey(school));
	if (text === null) return null;
	const lines = text.split("\n");
	let header: Partial<BundleHeader>;
	try {
		header = JSON.parse(lines[0] ?? "") as Partial<BundleHeader>;
	} catch {
		return null;
	}
	if (
		header.v !== ANSWERS_VERSION ||
		header.generation !== pointer.generation ||
		header.day !== pointer.day
	)
		return null;
	const answers = new Map<string, string>();
	for (const line of lines.slice(1)) {
		const tab = line.indexOf(SEPARATOR);
		if (tab > 0) answers.set(line.slice(0, tab), line.slice(tab + 1));
	}
	return answers;
};

export type WriteAnswersOutcome = "written" | "unchanged" | "no-views";

/**
 * Works out and stores the answers of the school's current generation for the local day of `now`: the log (when its
 * lines changed), the answers, then the pointer. Nothing is written when the pointer already names this generation and
 * day. `compute` is handed the opened generation (and `events`, the whole log, when the caller has just read it).
 */
export const writeAnswers = async (
	store: Store,
	school: string,
	now: Date,
	compute: (opened: OpenedGeneration) => Promise<{
		zone: string;
		events: readonly AtmEvent[];
		answers: ReadonlyMap<string, string>;
	}>,
): Promise<WriteAnswersOutcome> => {
	const [reader, stored] = await Promise.all([
		readViewsFromStore(store, school),
		readPointer(store, school),
	]);
	if (!reader.ok) return "no-views";
	const generation = await generationOf(reader.manifest);
	if (
		stored !== null &&
		stored.generation === generation &&
		localDayOf(now.getTime(), stored.zone) === stored.day
	)
		return "unchanged";
	const { zone, events, answers } = await compute({
		reader,
		generation,
		pointer: null,
	});
	const lines = eventLinesOf(events);
	const log = await sha256Hex(lines);
	if (stored?.log !== log)
		await putText(
			store,
			answersLogKey(school),
			`${JSON.stringify({ v: ANSWERS_VERSION, events: log })}\n${lines}`,
		);
	const day = localDayOf(now.getTime(), zone);
	const header: BundleHeader = { v: ANSWERS_VERSION, generation, day };
	await putText(
		store,
		answersBundleKey(school),
		`${[
			JSON.stringify(header),
			...[...answers].map(([name, data]) => `${name}${SEPARATOR}${data}`),
		].join("\n")}\n`,
	);
	const pointer: AnswersPointer = {
		v: ANSWERS_VERSION,
		generation,
		asOf: reader.manifest.asOf,
		zone,
		day,
		log,
	};
	await putText(
		store,
		answersPointerKey(school),
		`${JSON.stringify(pointer)}\n`,
	);
	return "written";
};
