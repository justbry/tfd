import { existsSync } from "node:fs";
import { join } from "node:path";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { DownloadFile } from "../../src/data/ledger.ts";
import { createHttpAdapters } from "../../src/http/adapters.ts";
import type { LedgerSchoolClaim } from "../../src/http/ledger-token.ts";
import type { Fetch } from "../../src/http/transport.ts";
import {
	createFetchWorkerSource,
	type WorkerSource,
} from "../../src/http/worker-source.ts";
import {
	manualScheduler,
	memoryStore,
	sequentialKeys,
} from "../s8e/helpers.ts";
import { memberRow, membersAnswer } from "../s8e/recorded.ts";

/**
 * The real ledger Worker for the S8e end-to-end tests: S8c's harness (`packages/ledger-worker/src/testing/harness.ts`,
 * `startLedgerWorker`) runs the Worker on Miniflare over a bucket seeded from atm's scenario presets, with a test
 * JWKS, and these helpers put part 1's HTTP adapters on it. buzz-school stays a fake built from part 1's recorded
 * answers (`test/s8e/recorded.ts`): its ledger-token route mints a real EdDSA token with the harness's key, so the
 * Worker checks a real signature.
 *
 * The harness is loaded by a computed path, so this package still type-checks and its tests still run before S8c is
 * merged: `harness` is then a reason to skip, printed once per file.
 */

export const harnessFile = join(
	import.meta.dir,
	"../../../ledger-worker/src/testing/harness.ts",
);

/** What these tests use of the harness (its own type lives in the ledger-worker package). */
export type SeededEvent = {
	id: string;
	event_type: string;
	event_time: string;
	date: string;
	key: string;
	postings: Array<{ account: string; amount: string; commodity: string }>;
	payload: Record<string, unknown>;
};
export type LedgerHarness = {
	url: string;
	mintToken(options: {
		sub: string;
		schools: LedgerSchoolClaim[];
		expiresInSeconds?: number;
	}): Promise<string>;
	stop(): Promise<void>;
	seeded: Record<
		string,
		{ id: string; preset: string; asOf: string; events: SeededEvent[] }
	>;
	clock: {
		now(): string;
		set(iso: string): void;
		advance(milliseconds: number): void;
	};
};
type HarnessModule = {
	startLedgerWorker(options: {
		presets: readonly string[];
		schools?: readonly string[];
		now?: string;
	}): Promise<LedgerHarness>;
};

/**
 * happy-dom (test/setup.ts) replaces the global timers with ones whose handles have no `unref`, which Miniflare calls
 * when it stops; its `fetch` also refuses an `http:` URL from the `https:` test page. The process's own timers come
 * back here (the app runs on them as well as on happy-dom's), and the Worker is fetched with `Bun.fetch`. Registering
 * happy-dom again gives the process a new window, so this group runs in its own process (scripts/test-all.ts), under a
 * directory name no other group's path filter matches (`bun test test/s8` would match `test/s8e-*`).
 */
await GlobalRegistrator.unregister();
const nativeTimers = {
	setTimeout: globalThis.setTimeout,
	clearTimeout: globalThis.clearTimeout,
};
GlobalRegistrator.register({ url: "https://ledger.test/" });
Object.assign(globalThis, nativeTimers);

export const harness: HarnessModule | string = await (async () => {
	if (!existsSync(harnessFile))
		return "skipped: packages/ledger-worker/src/testing/harness.ts does not exist (S8c is not merged into this branch)";
	try {
		return (await import(harnessFile)) as HarnessModule;
	} catch (error) {
		return `skipped: the S8c harness does not load (${String(error)}); run bun install at the repository root`;
	}
})();
if (typeof harness === "string") process.stdout.write(`${harness}\n`);

/** Miniflare's start and the seeding of a preset take seconds each. */
export const harnessTimeoutMilliseconds = 240_000;

export const apiBase = "https://api.b4uni.test";
export const subject = "profile_e2e";
const millisecondsPerSecond = 1000;

/** The menu of a school's latest `catalog.published` event, as buzz-school's `ledger/school` reads it (`menuFacts`). */
export function menuOf(events: readonly SeededEvent[]): {
	timeZone: string;
	currency: string;
	unit: { one: string; other: string } | null;
	tierIds: string[];
} | null {
	const published = events
		.filter((event) => event.event_type === "catalog.published")
		.sort((first, second) => (first.id < second.id ? -1 : 1))
		.at(-1);
	const menu = published?.payload.menu as
		| {
				timeZone?: string;
				currency?: string;
				features?: Array<{ unit?: { one?: string; other?: string } }>;
				tiers?: Array<{ id?: string }>;
		  }
		| undefined;
	if (!menu?.timeZone || !menu.currency) return null;
	const unit = menu.features?.[0]?.unit;
	return {
		timeZone: menu.timeZone,
		currency: menu.currency,
		unit: unit?.one && unit.other ? { one: unit.one, other: unit.other } : null,
		tierIds: (menu.tiers ?? []).flatMap((tier) => (tier.id ? [tier.id] : [])),
	};
}

/** The members-list name of a member key: made up here, as buzz-school's roster would give one. */
export const memberNameOf = (key: string): string =>
	`Member ${key.slice("family:".length)}`;

const json = (body: unknown, status = 200): Response =>
	Response.json(body, { status });

/**
 * buzz-school as the HTTP adapters call it, over the harness: `POST /school-admin/ledger-token` mints a token for
 * `grants` with the harness's key and clock, `GET .../ledger/school` answers the facts of the school's published menu,
 * `GET .../billing/members-list` one row per member key in the school's log. Any other route is a 404. A Worker URL
 * goes to the real Worker.
 */
export function fakeBuzzSchool(
	worker: LedgerHarness,
	grants: LedgerSchoolClaim[],
	options: { tokenLifetimeSeconds?: number } = {},
) {
	const lifetime = options.tokenLifetimeSeconds ?? 300;
	const minted: string[] = [];
	const workerCalls: string[] = [];
	const fetch: Fetch = async (url, init) => {
		if (url.startsWith(worker.url)) {
			workerCalls.push(url.slice(worker.url.length));
			return Bun.fetch(url, init);
		}
		const { pathname } = new URL(url);
		if (pathname === "/school-admin/ledger-token" && init.method === "POST") {
			const issuedAt = Math.floor(
				Date.parse(worker.clock.now()) / millisecondsPerSecond,
			);
			const token = await worker.mintToken({
				sub: subject,
				schools: grants,
				expiresInSeconds: lifetime,
			});
			minted.push(token);
			return json({ token, expiresAt: issuedAt + lifetime, schools: grants });
		}
		const route = /^\/school-admin\/schools\/([^/]+)\/(.+)$/.exec(pathname);
		const school = route ? decodeURIComponent(route[1] ?? "") : "";
		const seeded = worker.seeded[school];
		if (!route || !seeded) return json({ error: "not_found" }, 404);
		if (route[2] === "ledger/school") {
			const menu = menuOf(seeded.events);
			return json({
				school,
				name: `School ${school}`,
				timeZone: menu?.timeZone ?? null,
				currency: menu?.currency ?? null,
				creditUnit: menu?.unit ?? null,
			});
		}
		if (route[2] === "billing/members-list") {
			const keys = [
				...new Set(
					seeded.events
						.map((event) => event.key)
						.filter((key) => key.startsWith("family:")),
				),
			].sort();
			return json(
				membersAnswer(
					keys.map((key) =>
						memberRow({
							key,
							familyId: key.slice("family:".length),
							profileId: `profile-${key.slice("family:".length)}`,
							name: memberNameOf(key),
						}),
					),
				),
			);
		}
		return json({ error: "not_found" }, 404);
	};
	return { fetch, minted, workerCalls };
}

/** Part 1's adapters on the real Worker: the fetch WorkerSource at `${url}/v1`, buzz-school faked. */
export function httpAdaptersOn(
	worker: LedgerHarness,
	grants: LedgerSchoolClaim[],
	options: {
		tokenLifetimeSeconds?: number;
	} = {},
) {
	const buzzSchool = fakeBuzzSchool(worker, grants, options);
	const scheduler = manualScheduler();
	const saved: DownloadFile[] = [];
	let source: WorkerSource | null = null;
	const adapters = createHttpAdapters({
		fetch: buzzSchool.fetch,
		apiBase,
		scheduler,
		storage: memoryStore(),
		newKey: sequentialKeys(),
		worker: (tokens) => {
			source = createFetchWorkerSource({
				fetch: buzzSchool.fetch,
				base: `${worker.url}/v1`,
				tokens,
				scheduler,
			});
			return source;
		},
		files: { save: async (file) => void saved.push(file) },
	});
	if (!source) throw new Error("the adapters built no Worker source");
	return { ...adapters, worker: source as WorkerSource, buzzSchool, scheduler };
}

/** A raw GET of the Worker with a fresh token for `grants`: what the adapters are compared with. */
export async function rawGet(
	worker: LedgerHarness,
	grants: LedgerSchoolClaim[],
	path: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
	const token = await worker.mintToken({ sub: subject, schools: grants });
	const response = await Bun.fetch(`${worker.url}/v1${path}`, {
		headers: { authorization: `Bearer ${token}` },
	});
	return {
		status: response.status,
		body: (await response.json()) as Record<string, unknown>,
	};
}
