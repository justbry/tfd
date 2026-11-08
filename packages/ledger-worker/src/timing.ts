/**
 * The `Server-Timing` header of a `/v1` answer: where the request's time went, for the browser's network panel and the
 * staging timing script. One collector per request, never shared. Its entries name a phase and nothing else (no school,
 * no key, no token):
 *
 * - `endpoint;desc="<name>"`: the route's name (`schools`, `kpi`, `disclosure`, `demo-api`, ...).
 * - `auth`: checking the bearer token (and fetching the JWKS when it must); `desc="none"` when none was sent.
 * - `r2-manifest`, `r2-pointer`, `r2-answers`, `r2-index`: the R2 reads of the views manifest, the stored answers'
 *   pointer and bundle, and the demo index; `r2-log`, `r2-demo-api`, `r2-views` and `r2-list` for the stored log, a
 *   demo school's stored route answers, any other object and bucket listings. Each is the time at least one read of its
 *   kind was in flight, so reads made at once count once; `desc` counts the reads.
 * - `cache;desc="hit"|"miss"|"isolate"`: the Cache API lookup of a stored answer, or `isolate` when the isolate already
 *   held it and the Cache API was not asked.
 * - `fallback`: working the answer out from the views, when a stored answer could not serve it; `compute` for an
 *   endpoint that has no stored answers.
 * - `total`: from the request's arrival to its answer.
 *
 * On Workers the clock moves only across I/O, so a phase that only computes can read 0.
 */
import type { Store } from "./data/store-io.js";
import type { AnswersCache } from "./routes/stored.js";

type Span = { start: number; end: number };

const DEMO_INDEX = /^schools\/_demo-index\.json$/;
const R2_KINDS: ReadonlyArray<[RegExp, string]> = [
	[/\/views\/manifest\.json$/, "r2-manifest"],
	[/\/views\/answers\/current\.json$/, "r2-pointer"],
	[/\/views\/answers\/answers\.jsonl$/, "r2-answers"],
	[/\/views\/answers\/log\.jsonl$/, "r2-log"],
	[/\/demo-api\//, "r2-demo-api"],
	[DEMO_INDEX, "r2-index"],
];

/** Which `r2-*` entry a read of `key` counts under. */
export const r2KindOf = (key: string): string =>
	R2_KINDS.find(([pattern]) => pattern.test(key))?.[1] ?? "r2-views";

/** Busy time of a set of spans: the length of their union. */
const busyOf = (spans: readonly Span[]): number => {
	let busy = 0;
	let reach = Number.NEGATIVE_INFINITY;
	for (const { start, end } of [...spans].sort((a, b) => a.start - b.start)) {
		const from = Math.max(start, reach);
		if (end > from) busy += end - from;
		reach = Math.max(reach, end);
	}
	return busy;
};

const DECIMALS = 1;

export class Timing {
	readonly #clock: () => number;
	readonly #started: number;
	readonly #spans = new Map<string, Span[]>();
	readonly #descs = new Map<string, string>();
	#endpoint: string | null = null;

	constructor(clock: () => number = () => performance.now()) {
		this.#clock = clock;
		this.#started = clock();
	}

	/** Names the endpoint; a name only, never an id. */
	endpoint(name: string): void {
		this.#endpoint = name;
	}

	/** Labels an entry (`cache;desc="hit"`); the last label wins. */
	describe(name: string, desc: string): void {
		this.#descs.set(name, desc);
	}

	/** Runs `work`, counting its time under `name`, whether it answers or throws. */
	async measure<Value>(
		name: string,
		work: () => Promise<Value>,
	): Promise<Value> {
		const start = this.#clock();
		try {
			return await work();
		} finally {
			const spans = this.#spans.get(name) ?? [];
			spans.push({ start, end: this.#clock() });
			this.#spans.set(name, spans);
		}
	}

	/** Counts `name` at no time (a phase that was looked at and skipped). */
	note(name: string, desc: string): void {
		const now = this.#clock();
		const spans = this.#spans.get(name) ?? [];
		spans.push({ start: now, end: now });
		this.#spans.set(name, spans);
		this.describe(name, desc);
	}

	/** The header's value, with `total` up to now. */
	header(): string {
		const entries: string[] = [];
		if (this.#endpoint !== null)
			entries.push(`endpoint;desc="${this.#endpoint}"`);
		for (const [name, spans] of this.#spans) {
			const desc =
				this.#descs.get(name) ??
				(name.startsWith("r2-") ? `${spans.length}` : undefined);
			entries.push(
				`${name};dur=${busyOf(spans).toFixed(DECIMALS)}${desc === undefined ? "" : `;desc="${desc}"`}`,
			);
		}
		entries.push(
			`total;dur=${(this.#clock() - this.#started).toFixed(DECIMALS)}`,
		);
		return entries.join(", ");
	}
}

/** `store` with every read timed under its `r2-*` entry; writes pass through untimed. */
export const timedStore = (store: Store, timing: Timing): Store => ({
	putIfAbsent: (key, body) => store.putIfAbsent(key, body),
	putIfMatch: (key, body, etag) => store.putIfMatch(key, body, etag),
	get: (key, range) =>
		timing.measure(r2KindOf(key), () => store.get(key, range)),
	head: (key) => timing.measure(r2KindOf(key), () => store.head(key)),
	list: (options) => timing.measure("r2-list", () => store.list(options)),
	delete: (key, sha256) => store.delete(key, sha256),
	presign: (key, options) => store.presign(key, options),
});

/** `cache` with its lookups timed under `cache`, labelled hit or miss. */
export const timedCache = (
	cache: AnswersCache,
	timing: Timing,
): AnswersCache => ({
	match: async (key) => {
		try {
			const hit = await timing.measure("cache", () => cache.match(key));
			timing.describe("cache", hit === undefined ? "miss" : "hit");
			return hit;
		} catch (error) {
			timing.describe("cache", "error");
			throw error;
		}
	},
	put: (key, response) => cache.put(key, response),
});
