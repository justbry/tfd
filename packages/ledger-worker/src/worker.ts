/**
 * The ledger Worker: the read endpoints of the ledger UI (contract `plans/ledger-ui/S8-contract.md` section 11) over a
 * school's R2 views and event log, behind a ledger token, and a cron job that keeps the views current.
 *
 * Every `/v1` answer is `Cache-Control: private, no-store`, but a stored answer (`routes/stored.ts`): the KPI document,
 * the disclosure and the audience report of a generation whose answers the views job has stored are read from them, with
 * an `ETag` (`If-None-Match` answers 304) and `private, max-age=0, must-revalidate` (`public, max-age=60` on a demo
 * school). Order of checks: the token (401), the route, the school in the token's `schools[]` (404 `not_found`, the
 * same for an unknown school), the gate of the endpoint (403), the query (400), then the data (404 `no_data`, 409, 503).
 * Every check runs before a stored answer is looked up. Every `/v1` answer, errors too, carries `Server-Timing`
 * (`timing.ts`): the phases' names and times, no ids.
 *
 * Demo schools (`demo.ts`, `LEDGER_DEMO_SCHOOLS=on`): `GET /v1/schools` and a demo school's paths need no token. A
 * token that is sent is checked all the same (an invalid or expired one is a 401); a valid one that does not list the
 * demo school reads it too. Every caller holds a demo school as its owner with the finance grant; a config verify or
 * put on one is refused (403 `demo_read_only`). `demo-api/<route>` serves a demo school's answers to the buzz-school
 * reads (`routes/demo-api.ts`) to anyone, and is 404 for every other school.
 */
import { R2BindingStore } from "tfd/worker";
import {
	type Audience,
	audienceAllowed,
	audiences,
	type Caller,
	callerOf,
	maxAudienceOf,
	type SchoolGrant,
} from "./auth/claims.js";
import { JwksCache, JwksUnavailable } from "./auth/jwks.js";
import { type Jwks, kidOf, LEDGER_AUDIENCE, verifyJwt } from "./auth/jwt.js";
import {
	ANSWERS_VERSION,
	disclosureAnswerName,
	kpiAnswerName,
	openGeneration,
	pinLockedOf,
} from "./data/answers.js";
import { openSnapshot } from "./data/snapshot.js";
import { DEMO_GRANT, demoSchoolsOn, isDemoSchool } from "./demo.js";
import type { LedgerEnv, ScheduledController } from "./env.js";
import {
	ApiError,
	errorResponse,
	lagMinutesOf,
	notModifiedResponse,
	okResponse,
	plainResponse,
	storedResponse,
} from "./http.js";
import {
	type ConfigAction,
	MAX_BODY_BYTES,
	putConfigRoute,
	readConfigRoute,
	verifyConfigRoute,
} from "./routes/config.js";
import { demoApiRoute } from "./routes/demo-api.js";
import { fundraisingRoute } from "./routes/fundraising.js";
import {
	incomeStatementRoute,
	membersIncomeRoute,
} from "./routes/income-statement.js";
import {
	audienceReportOf,
	audienceReportRoute,
	clockOf,
	disclosureBeforeViews,
	disclosureRoute,
	kpiRoute,
} from "./routes/kpi.js";
import { ledgerRoute } from "./routes/ledger.js";
import { memberMoneyRoute } from "./routes/member-money.js";
import { dayRange, oneOf } from "./routes/query.js";
import { demoSchoolsRoute, schoolsRoute } from "./routes/schools.js";
import {
	type AnswersCache,
	pointerFor,
	storedAnswer,
	type WaitUntil,
} from "./routes/stored.js";
import { Timing, timedCache, timedStore } from "./timing.js";
import { runViewsJob, type ViewsJobResult } from "./views-job.js";

const SCHOOL_PATH = /^\/v1\/schools\/([^/]+)\/(.+)$/;
/** `demo-api/<route>`: a demo school's answers to the buzz-school reads (`routes/demo-api.ts`). */
const DEMO_API_PATH = /^\/v1\/schools\/([^/]+)\/demo-api\/(.+)$/;
const MEMBER_MONEY = /^members\/([^/]+)\/money$/;
/** `config/<name>` and `config/<name>/verify`: the school's config objects (S9 plan section 4). */
const CONFIG_PATH = /^config\/([^/]+?)(\/verify)?$/;
const CONFIG_SCHOOL_PATH = /^\/v1\/schools\/[^/]+\/config\/[^/]+?(\/verify)?$/;
const BEARER = /^Bearer\s+(\S+)$/i;
const MS_PER_SECOND = 1000;
const JWKS_FETCH_TIMEOUT_MS = 5000;
const IAT_LEEWAY_SECONDS = 5;
const REPORT_AUDIENCES = ["public", "member", "governance"] as const;
const ALL_AUDIENCES = audiences;
/** A stored answer of a real school: the browser keeps it, and asks again (`If-None-Match`) before each use. */
const STORED_PRIVATE = "private, max-age=0, must-revalidate";
/** A stored answer of a demo school (fictional, the same for every caller): anyone may keep it a minute. */
const STORED_DEMO = "public, max-age=60";
const ETAG_LIST = /\s*,\s*/;
const WEAK_PREFIX = /^W\//;

export type LedgerWorkerOptions = {
	/** The clock, in epoch milliseconds. */
	clock?: (env: LedgerEnv) => number | Promise<number>;
	/** How the JWKS is fetched. */
	fetchJwks?: (url: string) => Promise<Response>;
	/** The cache for stored answers; default `caches.default` where the runtime has it, else none. */
	answersCache?: AnswersCache | null;
};

/** What the fetch handler is handed beside the request: Workers' `ExecutionContext`, of which only `waitUntil`. */
export type FetchContext = { waitUntil(promise: Promise<unknown>): void };

type Handler = (context: RouteContext) => Promise<unknown>;
type RouteContext = {
	snapshot: Awaited<ReturnType<typeof openSnapshot>>;
	query: URLSearchParams;
	now: number;
	key: string | null;
	grant: SchoolGrant;
};

/** Which stored answer serves a request, once the checks have passed. */
type StoredUse = {
	/** The answer's name in the generation's answers (`data/answers.ts`). */
	name: string;
	/** What else the answer depends on, for its ETag: the audience, and the query fields it reads. */
	tag: string;
	/** The data of the response from the stored answer's; the stored answer as it is when absent. */
	render?: (stored: string) => string;
};

type Route = {
	/** Who may call it: `finance` needs `finance:true`. */
	gate: "any" | "finance";
	/** Checks the query against the caller's grant before any data is read. */
	check?: (query: URLSearchParams, grant: SchoolGrant) => void;
	/** The stored answer that serves it, when the generation has one; called after `check`. */
	stored?: (query: URLSearchParams, grant: SchoolGrant) => StoredUse;
	handle: Handler;
};

const audienceGate = (
	query: URLSearchParams,
	grant: SchoolGrant,
	allowed: readonly Audience[],
): Audience => {
	const asked = oneOf(query, "audience", allowed, true) as Audience;
	if (!audienceAllowed(asked, grant))
		throw new ApiError(
			"audience_not_allowed",
			"That audience is finer than this account may view.",
		);
	return asked;
};

/** The books audience the View as Admin row shows this caller. D7: an admin without the finance grant reads the books
 * at their own (public) audience; an owner or a finance admin previewing the row sees `member`. */
const adminAudienceOf = (grant: SchoolGrant): Audience =>
	grant.role === "owner" || grant.finance ? "member" : maxAudienceOf(grant);

const routes: Record<string, Route> = {
	kpi: {
		gate: "any",
		check: (query, grant) => {
			audienceGate(query, grant, ALL_AUDIENCES);
			oneOf(query, "pin", ["open", "locked"], true);
		},
		stored: (query) => {
			const audience = query.get("audience") as Audience;
			const locked = pinLockedOf(audience, query.get("pin"));
			return {
				name: kpiAnswerName(audience, locked),
				tag: `kpi-${audience}-${locked ? "locked" : "open"}`,
			};
		},
		handle: ({ snapshot, query, now }) =>
			kpiRoute(
				snapshot,
				query.get("audience") as Audience,
				// the PIN opens the books from governance up: below it `locked` is always allowed and means nothing
				pinLockedOf(query.get("audience") as Audience, query.get("pin")),
				now,
			),
	},
	disclosure: {
		gate: "any",
		// the caller's grant picks the answer: the ETag names it, so a browser that changes token reads it again
		stored: (_query, grant) => ({
			name: disclosureAnswerName(adminAudienceOf(grant)),
			tag: `disclosure-${adminAudienceOf(grant)}`,
		}),
		handle: ({ snapshot, now, grant }) =>
			disclosureRoute(snapshot, now, adminAudienceOf(grant)),
	},
	"audience-report": {
		gate: "any",
		check: (query, grant) => {
			audienceGate(query, grant, REPORT_AUDIENCES);
		},
		// the report is the audience's KPI document read at `from`: the stored document, then `audienceReportOf`
		stored: (query) => {
			const audience = query.get(
				"audience",
			) as (typeof REPORT_AUDIENCES)[number];
			const { from } = dayRange(query);
			return {
				name: kpiAnswerName(audience, false),
				tag: `audience-report-${audience}-${from}`,
				render: (stored) =>
					JSON.stringify(audienceReportOf(JSON.parse(stored), audience, from)),
			};
		},
		handle: ({ snapshot, query, now }) =>
			audienceReportRoute(snapshot, query, now),
	},
	ledger: {
		gate: "finance",
		handle: ({ snapshot, query }) => ledgerRoute(snapshot, query),
	},
	"income-statement": {
		gate: "finance",
		handle: async ({ snapshot, query, now }) =>
			incomeStatementRoute(
				snapshot,
				query,
				(await clockOf(snapshot, now)).today,
			),
	},
	"members-income": {
		gate: "finance",
		handle: ({ snapshot, query }) => membersIncomeRoute(snapshot, query),
	},
	fundraising: {
		gate: "finance",
		handle: ({ snapshot, query }) => fundraisingRoute(snapshot, query),
	},
};

const memberMoney: Route = {
	gate: "finance",
	handle: ({ snapshot, key }) => memberMoneyRoute(snapshot, key ?? ""),
};

/** The config action a method and path ask for, or null when the path is not a config path. */
const configActionOf = (
	method: string,
	rest: string,
): { name: string; action: ConfigAction } | null => {
	const match = CONFIG_PATH.exec(rest);
	if (match === null) return null;
	const name = decode(match[1] as string);
	const verify = match[2] !== undefined;
	const action: ConfigAction | null =
		verify && method === "POST"
			? "verify"
			: !verify && method === "GET"
				? "read"
				: !verify && method === "PUT"
					? "put"
					: null;
	if (action === null)
		throw new ApiError(
			"method_not_allowed",
			"That method is not served on this path.",
		);
	return { name, action };
};

const decode = (segment: string): string => {
	try {
		return decodeURIComponent(segment);
	} catch {
		throw new ApiError("bad_request", "The path is not valid.");
	}
};

/** The school a `/v1/schools/:school/...` path names, or null (no school path, or one that does not decode). */
const schoolOfPath = (pathname: string): string | null => {
	const segment = SCHOOL_PATH.exec(pathname)?.[1];
	if (segment === undefined) return null;
	try {
		return decodeURIComponent(segment);
	} catch {
		return null;
	}
};

const tokenMissing = (): ApiError =>
	new ApiError("token_missing", "A bearer token is required.");

/** Whether `If-None-Match` names `etag` (or is `*`); a weak validator compares as a strong one. */
const matchesEtag = (header: string | null, etag: string): boolean =>
	(header ?? "")
		.trim()
		.split(ETAG_LIST)
		.some((tag) => tag === "*" || tag.replace(WEAK_PREFIX, "") === etag);

/** `caches.default`, where the runtime has one (Workers, Miniflare); none under Bun. */
const defaultAnswersCache = (): AnswersCache | null =>
	(globalThis as { caches?: { default?: AnswersCache } }).caches?.default ??
	null;

/** The answer with its `Server-Timing` (`timing.ts`), `total` up to now. */
const withTiming = (response: Response, timing: Timing): Response => {
	const timed = new Response(response.body, response);
	timed.headers.set("server-timing", timing.header());
	return timed;
};

export const createLedgerWorker = (options: LedgerWorkerOptions = {}) => {
	const clock = options.clock ?? (() => Date.now());
	const answersCache = (): AnswersCache | null =>
		options.answersCache === undefined
			? defaultAnswersCache()
			: options.answersCache;
	const fetchJwks =
		options.fetchJwks ??
		((url: string) =>
			fetch(url, { signal: AbortSignal.timeout(JWKS_FETCH_TIMEOUT_MS) }));
	const caches = new Map<string, JwksCache>();
	const cacheFor = (url: string): JwksCache => {
		let cache = caches.get(url);
		if (cache === undefined) {
			cache = new JwksCache(url, fetchJwks);
			caches.set(url, cache);
		}
		return cache;
	};

	/** The token's caller, or null when the request sends no `Authorization` header at all. */
	const authenticate = async (
		request: Request,
		env: LedgerEnv,
		now: number,
	): Promise<Caller | null> => {
		const header = request.headers.get("authorization");
		if (header === null) return null;
		const token = BEARER.exec(header)?.[1];
		if (token === undefined) throw tokenMissing();
		const cache = cacheFor(env.LEDGER_JWKS_URL);
		const verifyOptions = {
			iss: env.LEDGER_ISS,
			aud: LEDGER_AUDIENCE,
			now: Math.floor(now / MS_PER_SECOND),
			leewaySeconds: IAT_LEEWAY_SECONDS,
		};
		let keys: Jwks;
		try {
			keys = await cache.current(now);
		} catch (error) {
			if (error instanceof JwksUnavailable)
				throw new ApiError(
					"jwks_unavailable",
					"Tokens cannot be checked right now.",
				);
			throw error;
		}
		let verified = await verifyJwt(token, keys, verifyOptions);
		if (
			!verified.ok &&
			verified.reason === "unknown_kid" &&
			kidOf(token) !== null
		) {
			const fresh = await cache.refetchForUnknownKid(now);
			if (fresh !== null)
				verified = await verifyJwt(token, fresh, verifyOptions);
		}
		if (!verified.ok)
			throw new ApiError(
				verified.reason === "expired" ? "token_expired" : "token_invalid",
				verified.reason === "expired"
					? "The token has expired."
					: "The token is not valid.",
			);
		return callerOf(verified);
	};

	const serveV1 = async (
		request: Request,
		env: LedgerEnv,
		url: URL,
		now: number,
		waitUntil: WaitUntil,
		timing: Timing,
	): Promise<Response> => {
		let caller: Caller | null = null;
		if (request.headers.has("authorization"))
			caller = await timing.measure("auth", () =>
				authenticate(request, env, now),
			);
		else timing.note("auth", "none");
		const demoApi = DEMO_API_PATH.exec(url.pathname);
		if (demoApi !== null) {
			// a demo school's buzz-school answers: no token needed, and nothing for any other school
			timing.endpoint("demo-api");
			const school = decode(demoApi[1] as string);
			if (!isDemoSchool(school, env))
				throw new ApiError("not_found", "No such endpoint.");
			if (request.method !== "GET")
				throw new ApiError("method_not_allowed", "Only GET is served.");
			return demoApiRoute(
				timedStore(new R2BindingStore(env.LEDGER_BUCKET), timing),
				school,
				demoApi[2] as string,
				url.searchParams,
				now,
			);
		}
		const demoOn = demoSchoolsOn(env);
		if (caller === null) {
			// no token: only the demo schools' list and paths, and only where they are on
			const pathSchool = schoolOfPath(url.pathname);
			const open =
				url.pathname === "/v1/schools"
					? demoOn
					: pathSchool !== null && isDemoSchool(pathSchool, env);
			if (!open) throw tokenMissing();
		}
		/** The caller's grant on `school`: any caller's owner grant on a demo school, else the token's entry. */
		const grantOf = (school: string): SchoolGrant => {
			if (isDemoSchool(school, env)) return DEMO_GRANT;
			const grant = caller?.schools.get(school);
			if (grant === undefined)
				throw new ApiError("not_found", "No such school.");
			return grant;
		};
		const configPath = CONFIG_SCHOOL_PATH.exec(url.pathname);
		if (request.method !== "GET" && configPath === null)
			throw new ApiError("method_not_allowed", "Only GET is served.");
		const store = timedStore(new R2BindingStore(env.LEDGER_BUCKET), timing);
		if (url.pathname === "/v1/schools") {
			timing.endpoint("schools");
			const ids = caller === null ? [] : [...caller.schools.keys()];
			const [listed, demo] = await Promise.all([
				schoolsRoute(store, ids, now),
				demoOn ? demoSchoolsRoute(store, new Set(ids), now) : [],
			]);
			const freshness = [...listed, ...demo];
			const known = freshness.flatMap((school) =>
				school.asOf === null ? [] : [school.asOf],
			);
			// the oldest views of the lot: everything is at least this fresh
			const asOf =
				known.length === 0 ? null : known.reduce((a, b) => (a < b ? a : b));
			return okResponse(
				{ schools: freshness },
				{ asOf, lagMinutes: asOf === null ? null : lagMinutesOf(asOf, now) },
			);
		}
		const match = SCHOOL_PATH.exec(url.pathname);
		if (match === null) throw new ApiError("not_found", "No such endpoint.");
		const school = decode(match[1] as string);
		const rest = match[2] as string;
		const config = configActionOf(request.method, rest);
		if (config !== null) {
			timing.endpoint(`config-${config.action}`);
			const grant = grantOf(school);
			if (config.action !== "read" && isDemoSchool(school, env))
				throw new ApiError(
					"demo_read_only",
					"Demo school: read-only. Its config cannot be changed.",
				);
			const context = {
				store,
				school,
				name: config.name,
				grant,
				subject: caller?.subject ?? null,
				stepUpAt: caller?.stepUpAt ?? null,
				now,
				request,
			};
			return config.action === "read"
				? readConfigRoute(context)
				: config.action === "verify"
					? verifyConfigRoute(context)
					: putConfigRoute(context);
		}
		const moneyKey = MEMBER_MONEY.exec(rest)?.[1];
		// own keys only: `constructor` or `__proto__` is not an endpoint
		const route =
			moneyKey === undefined
				? Object.hasOwn(routes, rest)
					? routes[rest]
					: undefined
				: memberMoney;
		if (route === undefined)
			throw new ApiError("not_found", "No such endpoint.");
		timing.endpoint(moneyKey === undefined ? rest : "member-money");
		const grant = grantOf(school);
		if (route.gate === "finance" && !grant.finance)
			throw new ApiError(
				"finance_required",
				"This needs the finance grant on the school.",
			);
		route.check?.(url.searchParams, grant);
		const use = route.stored?.(url.searchParams, grant);
		// every check above has passed: only now is a stored answer looked up
		const opened = await openGeneration(store, school);
		const pointer = use === undefined ? null : pointerFor(opened, now);
		if (use !== undefined && pointer !== null) {
			const etag = `"v${ANSWERS_VERSION}-${pointer.generation}-${pointer.day}-${use.tag}"`;
			const headers = {
				etag,
				"cache-control": isDemoSchool(school, env)
					? STORED_DEMO
					: STORED_PRIVATE,
			};
			if (matchesEtag(request.headers.get("if-none-match"), etag))
				return notModifiedResponse(headers);
			const cache = answersCache();
			const stored = await storedAnswer({
				store,
				school,
				pointer,
				name: use.name,
				origin: url.origin,
				cache: cache === null ? null : timedCache(cache, timing),
				waitUntil,
				timing,
			});
			if (stored !== null)
				return storedResponse(
					use.render === undefined ? stored : use.render(stored),
					{ asOf: pointer.asOf, lagMinutes: lagMinutesOf(pointer.asOf, now) },
					headers,
				);
		}
		// no stored answer served it: worked out from the views (a fallback where the endpoint has stored answers)
		return timing.measure(
			route.stored === undefined ? "compute" : "fallback",
			async () => {
				const snapshot = await openSnapshot(store, school, { opened }).catch(
					(error) => {
						// The disclosure is policy, not data: a school with no views yet still answers it (the defaults).
						if (
							route === routes.disclosure &&
							error instanceof ApiError &&
							error.code === "no_data"
						)
							return null;
						throw error;
					},
				);
				if (snapshot === null)
					return okResponse(
						disclosureBeforeViews(school, now, adminAudienceOf(grant)),
						{ asOf: null, lagMinutes: null },
					);
				const data = await route.handle({
					snapshot,
					query: url.searchParams,
					now,
					key: moneyKey === undefined ? null : decode(moneyKey),
					grant,
				});
				return okResponse(data, {
					asOf: snapshot.asOf,
					lagMinutes: lagMinutesOf(snapshot.asOf, now),
				});
			},
		);
	};

	return {
		async fetch(
			request: Request,
			env: LedgerEnv,
			context?: FetchContext,
		): Promise<Response> {
			const url = new URL(request.url);
			if (url.pathname === "/healthz") return plainResponse({ ok: true });
			if (!url.pathname.startsWith("/v1/")) {
				if (env.ASSETS !== undefined) return env.ASSETS.fetch(request);
				return errorResponse(new ApiError("not_found", "Not found."));
			}
			const timing = new Timing();
			try {
				// without a context (tests in-process) the cache is filled before the answer goes
				const pending: Promise<unknown>[] = [];
				const waitUntil: WaitUntil = (promise) =>
					context === undefined
						? pending.push(promise)
						: context.waitUntil(promise);
				const response = await serveV1(
					request,
					env,
					url,
					await clock(env),
					waitUntil,
					timing,
				);
				await Promise.all(pending);
				return withTiming(response, timing);
			} catch (error) {
				if (error instanceof ApiError)
					return withTiming(errorResponse(error), timing);
				// R2 or the runtime failed: nothing to show for it, and nothing about the request is logged
				console.error(
					"ledger request failed",
					error instanceof Error ? error.name : "unknown",
				);
				return withTiming(
					errorResponse(
						new ApiError(
							"views_unavailable",
							"The ledger cannot be read right now.",
						),
					),
					timing,
				);
			} finally {
				// A refusal that never read the body (owner_only, step_up_required, demo_read_only) would leave it on the
				// connection. One of a config body's size is read to the end, so the connection stays usable for the
				// caller's next request (a cancelled one can reset it); a larger or unsized one is cancelled.
				if (request.body !== null && !request.bodyUsed) {
					const declared = Number(request.headers.get("content-length"));
					if (
						request.headers.has("content-length") &&
						declared <= MAX_BODY_BYTES
					)
						await request.arrayBuffer().catch(() => undefined);
					else await request.body.cancel();
				}
			}
		},

		async scheduled(
			controller: ScheduledController,
			env: LedgerEnv,
		): Promise<ViewsJobResult[]> {
			return runViewsJob(
				new R2BindingStore(env.LEDGER_BUCKET),
				new Date(controller.scheduledTime),
			);
		},
	};
};
