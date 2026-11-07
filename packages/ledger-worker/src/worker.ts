/**
 * The ledger Worker: the read endpoints of the ledger UI (contract `plans/ledger-ui/S8-contract.md` section 11) over a
 * school's R2 views and event log, behind a ledger token, and a cron job that keeps the views current.
 *
 * Every `/v1` answer is `Cache-Control: private, no-store`. Order of checks: the token (401), the route, the school in the
 * token's `schools[]` (404 `not_found`, the same for an unknown school), the gate of the endpoint (403), the query (400),
 * then the data (404 `no_data`, 409, 503).
 */
import { R2BindingStore } from "atm/worker";
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
import { openSnapshot } from "./data/snapshot.js";
import type { LedgerEnv, ScheduledController } from "./env.js";
import {
	ApiError,
	errorResponse,
	lagMinutesOf,
	okResponse,
	plainResponse,
} from "./http.js";
import { fundraisingRoute } from "./routes/fundraising.js";
import {
	incomeStatementRoute,
	membersIncomeRoute,
} from "./routes/income-statement.js";
import {
	audienceReportRoute,
	clockOf,
	disclosureRoute,
	kpiRoute,
} from "./routes/kpi.js";
import { ledgerRoute } from "./routes/ledger.js";
import { memberMoneyRoute } from "./routes/member-money.js";
import { oneOf } from "./routes/query.js";
import { schoolsRoute } from "./routes/schools.js";
import { runViewsJob, type ViewsJobResult } from "./views-job.js";

const SCHOOL_PATH = /^\/v1\/schools\/([^/]+)\/(.+)$/;
const MEMBER_MONEY = /^members\/([^/]+)\/money$/;
const BEARER = /^Bearer\s+(\S+)$/i;
const MS_PER_SECOND = 1000;
const JWKS_FETCH_TIMEOUT_MS = 5000;
const IAT_LEEWAY_SECONDS = 5;
const REPORT_AUDIENCES = ["public", "member", "governance"] as const;
const ALL_AUDIENCES = audiences;

export type LedgerWorkerOptions = {
	/** The clock, in epoch milliseconds. */
	clock?: (env: LedgerEnv) => number | Promise<number>;
	/** How the JWKS is fetched. */
	fetchJwks?: (url: string) => Promise<Response>;
};

type Handler = (context: RouteContext) => Promise<unknown>;
type RouteContext = {
	snapshot: Awaited<ReturnType<typeof openSnapshot>>;
	query: URLSearchParams;
	now: number;
	key: string | null;
	grant: SchoolGrant;
};

type Route = {
	/** Who may call it: `finance` needs `finance:true`. */
	gate: "any" | "finance";
	/** Checks the query against the caller's grant before any data is read. */
	check?: (query: URLSearchParams, grant: SchoolGrant) => void;
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

const routes: Record<string, Route> = {
	kpi: {
		gate: "any",
		check: (query, grant) => {
			audienceGate(query, grant, ALL_AUDIENCES);
			oneOf(query, "pin", ["open", "locked"], true);
		},
		handle: ({ snapshot, query, now }) =>
			kpiRoute(
				snapshot,
				query.get("audience") as Audience,
				// the PIN opens the books from governance up: below it `locked` is always allowed and means nothing
				query.get("pin") === "locked" &&
					ALL_AUDIENCES.indexOf(query.get("audience") as Audience) >=
						ALL_AUDIENCES.indexOf("governance"),
				now,
			),
	},
	disclosure: {
		gate: "any",
		handle: ({ snapshot, now, grant }) =>
			disclosureRoute(
				snapshot,
				now,
				// D7: an admin without the finance grant reads the books at their own (public) audience
				grant.role === "owner" || grant.finance
					? "member"
					: maxAudienceOf(grant),
			),
	},
	"audience-report": {
		gate: "any",
		check: (query, grant) => {
			audienceGate(query, grant, REPORT_AUDIENCES);
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

const decode = (segment: string): string => {
	try {
		return decodeURIComponent(segment);
	} catch {
		throw new ApiError("bad_request", "The path is not valid.");
	}
};

export const createLedgerWorker = (options: LedgerWorkerOptions = {}) => {
	const clock = options.clock ?? (() => Date.now());
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

	const authenticate = async (
		request: Request,
		env: LedgerEnv,
		now: number,
	): Promise<Caller> => {
		const header = request.headers.get("authorization");
		if (header === null)
			throw new ApiError("token_missing", "A bearer token is required.");
		const token = BEARER.exec(header)?.[1];
		if (token === undefined)
			throw new ApiError("token_missing", "A bearer token is required.");
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
	): Promise<Response> => {
		const caller = await authenticate(request, env, now);
		if (request.method !== "GET")
			throw new ApiError("method_not_allowed", "Only GET is served.");
		const store = new R2BindingStore(env.LEDGER_BUCKET);
		if (url.pathname === "/v1/schools") {
			const freshness = await schoolsRoute(
				store,
				[...caller.schools.keys()],
				now,
			);
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
		const grant = caller.schools.get(school);
		if (grant === undefined) throw new ApiError("not_found", "No such school.");
		if (route.gate === "finance" && !grant.finance)
			throw new ApiError(
				"finance_required",
				"This needs the finance grant on the school.",
			);
		route.check?.(url.searchParams, grant);
		const snapshot = await openSnapshot(store, school);
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
	};

	return {
		async fetch(request: Request, env: LedgerEnv): Promise<Response> {
			const url = new URL(request.url);
			if (url.pathname === "/healthz") return plainResponse({ ok: true });
			if (!url.pathname.startsWith("/v1/")) {
				if (env.ASSETS !== undefined) return env.ASSETS.fetch(request);
				return errorResponse(new ApiError("not_found", "Not found."));
			}
			try {
				return await serveV1(request, env, url, await clock(env));
			} catch (error) {
				if (error instanceof ApiError) return errorResponse(error);
				// R2 or the runtime failed: nothing to show for it, and nothing about the request is logged
				console.error(
					"ledger request failed",
					error instanceof Error ? error.name : "unknown",
				);
				return errorResponse(
					new ApiError(
						"views_unavailable",
						"The ledger cannot be read right now.",
					),
				);
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
