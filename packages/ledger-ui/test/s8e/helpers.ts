import type { Scheduler } from "../../src/http/transport.ts";

/** Ids shaped as buzz-school's (lower-case uuids), so the paths match `LEDGER_ROUTES`. */
export const schoolId = "6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b";
export const otherSchoolId = "7a2b3c4d-5e6f-4a1b-9c2d-3e4f5a6b7c8d";
export const bookingId = "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e";
export const familyId = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
export const profileId = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a";
export const membershipId = "3e4f5a6b-7c8d-4e9f-8a0b-2c3d4e5f6a7b";
/** A roster pubkey: built, so no key-shaped literal sits in the source. */
export const adminPubkey = "ab".repeat(32);
export const apiBase = "https://api.b4uni.test";

export type Call = {
	url: string;
	method: string;
	headers: Record<string, string>;
	body: unknown;
	credentials: string | undefined;
};
export type Answer =
	| { status: number; body?: unknown; headers?: Record<string, string> }
	| "network";
type Route = {
	method: string;
	path: RegExp;
	answers: Answer[];
	repeat: boolean;
};

/** A fetch that replays recorded answers by method and path, in order, and records every request. */
export function fakeFetch() {
	const calls: Call[] = [];
	const table: Route[] = [];
	const fetch = async (url: string, init: RequestInit): Promise<Response> => {
		const method = init.method ?? "GET";
		const headers = Object.fromEntries(
			Object.entries((init.headers ?? {}) as Record<string, string>),
		);
		const body =
			typeof init.body === "string" ? JSON.parse(init.body) : undefined;
		calls.push({ url, method, headers, body, credentials: init.credentials });
		const { pathname } = new URL(url);
		const route = table.find(
			(entry) =>
				entry.method === method &&
				entry.path.test(pathname) &&
				entry.answers.length > 0,
		);
		if (!route) throw new Error(`no recorded answer for ${method} ${pathname}`);
		const answer = (
			route.repeat ? route.answers[0] : route.answers.shift()
		) as Answer;
		if (answer === "network") throw new TypeError("Failed to fetch");
		return new Response(
			answer.body === undefined ? null : JSON.stringify(answer.body),
			{
				status: answer.status,
				headers: { "content-type": "application/json", ...answer.headers },
			},
		);
	};
	return {
		fetch,
		calls,
		/** Answers, once each in order, for `method` and a path matching `path`. */
		on(method: string, path: RegExp, ...answers: Answer[]) {
			table.push({ method, path, answers, repeat: false });
		},
		/** The same answer every time. */
		always(method: string, path: RegExp, answer: Answer) {
			table.push({ method, path, answers: [answer], repeat: true });
		},
		paths: () => calls.map(({ url }) => new URL(url).pathname),
	};
}

/** Timers run by hand: `advance(seconds)` fires what is due; `wait` resolves at once and is recorded. */
export function manualScheduler(): Scheduler & {
	advance(seconds: number): void;
	waits: number[];
	pending(): number;
} {
	let now = 0;
	const timers: Array<{ at: number; run: () => void; live: boolean }> = [];
	const waits: number[] = [];
	return {
		waits,
		wait: async (seconds) => {
			waits.push(seconds);
		},
		after: (seconds, run) => {
			const timer = { at: now + seconds, run, live: true };
			timers.push(timer);
			return () => {
				timer.live = false;
			};
		},
		advance(seconds) {
			now += seconds;
			for (const timer of timers)
				if (timer.live && timer.at <= now) {
					timer.live = false;
					timer.run();
				}
		},
		pending: () => timers.filter(({ live }) => live).length,
	};
}

const base64Url = (text: string): string =>
	btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
/** A JWT-shaped ledger token: the adapter reads only the payload (the Worker verifies the signature). */
export const tokenFor = (claims: Record<string, unknown>): string =>
	`${base64Url(JSON.stringify({ alg: "EdDSA", typ: "JWT", kid: "k1" }))}.${base64Url(JSON.stringify(claims))}.signature`;

export function memoryStore() {
	const items = new Map<string, string>();
	return {
		getItem: (key: string) => items.get(key) ?? null,
		setItem: (key: string, value: string) => void items.set(key, value),
		items,
	};
}

/** Keys `action-0001`, `action-0002`, … for one set of adapters. */
export function sequentialKeys(prefix = "action"): () => string {
	let counter = 0;
	return () => {
		counter += 1;
		return `${prefix}-${String(counter).padStart(4, "0")}`;
	};
}
