import {
	checkoutParams,
	type Interval,
	toStripeForm,
	withPriceIds,
} from "../../../../packages/atm/src/cloud.ts";
import type { CloudEnv } from "../env";
import { type Org, PUBLISHED, SCHOOL_OF, soldTier } from "./plans";

const STRIPE_CHECKOUT = "https://api.stripe.com/v1/checkout/sessions";
const MAX_BODY_BYTES = 2048;
const MAX_EMAIL_LENGTH = 254;
const EMAIL =
	/^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/;
const TIER_ID = /^[a-z0-9-]{1,40}$/;
/** A test-mode key: staging never holds a live one. */
const TEST_KEY = /^(sk|rk)_test_/;
const encoder = new TextEncoder();

export type CheckoutRequest = {
	tier: string;
	interval: Interval;
	org: Org;
	email?: string;
};

type Invalid = { ok: false; status: number; code: string; message: string };

const invalid = (code: string, message: string, status = 400): Invalid => ({
	ok: false,
	status,
	code,
	message,
});

/** Checks the body of `POST /v1/billing/checkout`: `{ tier, interval: month|year, org: std|np, email? }`, nothing else. */
export const parseCheckoutRequest = (
	body: unknown,
): { ok: true; request: CheckoutRequest } | Invalid => {
	if (!body || typeof body !== "object" || Array.isArray(body))
		return invalid("bad_request", "Send a JSON object.");
	const { tier, interval, org, email, ...rest } = body as Record<
		string,
		unknown
	>;
	const extra = Object.keys(rest);
	if (extra.length > 0)
		return invalid("bad_request", `Unknown field: ${extra.join(", ")}.`);
	if (typeof tier !== "string" || !TIER_ID.test(tier))
		return invalid("unknown_tier", "No such plan.");
	if (interval !== "month" && interval !== "year")
		return invalid("bad_interval", "interval is month or year.");
	if (org !== "std" && org !== "np")
		return invalid("bad_org", "org is std or np.");
	if (
		email !== undefined &&
		(typeof email !== "string" ||
			email.length > MAX_EMAIL_LENGTH ||
			!EMAIL.test(email))
	)
		return invalid("bad_email", "That email address does not look right.");
	const sold = soldTier(org, tier, interval);
	if (!sold.ok)
		return sold.reason === "tier_not_sold"
			? invalid("tier_not_sold", "This plan is not on sale yet.")
			: invalid("unknown_tier", "No such plan.");
	return {
		ok: true,
		request: { tier, interval, org, ...(email ? { email } : {}) },
	};
};

/**
 * A stable, opaque id for the account that buys: `family_id` on the subscription and its invoices, so the books name
 * the buyer without an email. Until sign-in exists (PLAN.md M2) each checkout mints one; it then stays on the
 * subscription for life, and an account made later takes it over.
 */
export const newAccountId = (): string =>
	`tfa_${crypto.randomUUID().replaceAll("-", "")}`;

/** The Checkout Session's form fields: tfd's `checkoutParams` with the published price ids and the return pages. */
export const checkoutForm = (
	request: CheckoutRequest,
	input: { accountId: string; ledgerHost: string },
): Record<string, string> => {
	const sold = soldTier(request.org, request.tier, request.interval);
	if (!sold.ok) throw new Error(`not sold: ${request.tier}`);
	const { school } = sold;
	const schoolId = SCHOOL_OF[request.org];
	const made = checkoutParams({
		schoolId,
		menu: school.menu,
		tierId: request.tier,
		interval: request.interval,
		familyId: input.accountId,
		menuVersion: school.menuVersion,
		policy: school.policy,
		returnUrls: {
			success: `https://${input.ledgerHost}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
			cancel: `https://${input.ledgerHost}/billing/cancel`,
		},
	});
	if (!made.ok) throw new Error(`checkoutParams refused: ${made.reason}`);
	const priced = withPriceIds(made.params, school.priceIds);
	if (!priced) throw new Error(`a price of ${request.tier} is not published`);
	return {
		...toStripeForm(priced),
		...(request.email ? { customer_email: request.email } : {}),
	};
};

/** Creates the Checkout Session at Stripe (test mode only) and answers its id and hosted URL. */
export const createCheckoutSession = async (
	env: CloudEnv,
	request: CheckoutRequest,
	fetcher: typeof fetch = fetch,
): Promise<{ id: string; url: string }> => {
	const key = env.STRIPE_SECRET_KEY;
	if (!key || !TEST_KEY.test(key))
		throw new Error("STRIPE_SECRET_KEY is missing or not a test-mode key");
	const accountId = newAccountId();
	const response = await fetcher(STRIPE_CHECKOUT, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${key}`,
			"Content-Type": "application/x-www-form-urlencoded",
			"Stripe-Version": PUBLISHED.apiVersion,
			"Idempotency-Key": `checkout:${accountId}`,
		},
		body: new URLSearchParams(
			checkoutForm(request, { accountId, ledgerHost: env.LEDGER_HOST }),
		),
	});
	const session = (await response.json()) as {
		id?: string;
		url?: string;
		livemode?: boolean;
		error?: { type?: string; code?: string };
	};
	if (!response.ok || !session.id || !session.url)
		throw new Error(
			`Stripe refused the session: ${response.status} ${session.error?.type ?? ""} ${session.error?.code ?? ""}`,
		);
	if (session.livemode !== false)
		throw new Error("Stripe answered a live-mode session on staging");
	return { id: session.id, url: session.url };
};

/** Light per-isolate limit: a few checkouts a minute per client address. */
const WINDOW_MS = 60_000;
const PER_WINDOW = 10;
/** Clients tracked at once; past it, clients with no checkout in the window are dropped (never the limited ones). */
const MAX_TRACKED_CLIENTS = 10_000;
const recent = new Map<string, number[]>();

const dropIdleClients = (nowMs: number): void => {
	for (const [client, times] of recent)
		if (times.every((at) => nowMs - at >= WINDOW_MS)) recent.delete(client);
	if (recent.size > MAX_TRACKED_CLIENTS) recent.clear();
};

export const allowCheckout = (client: string, nowMs: number): boolean => {
	const kept = (recent.get(client) ?? []).filter(
		(at) => nowMs - at < WINDOW_MS,
	);
	if (kept.length >= PER_WINDOW) {
		recent.set(client, kept);
		return false;
	}
	kept.push(nowMs);
	recent.set(client, kept);
	if (recent.size > MAX_TRACKED_CLIENTS) dropIdleClients(nowMs);
	return true;
};

/** Tests reset the limiter between cases. */
export const resetCheckoutLimit = (): void => recent.clear();

const corsHeaders = (env: CloudEnv): Record<string, string> => ({
	"Access-Control-Allow-Origin": `https://${env.LEDGER_HOST}`,
	"Access-Control-Allow-Methods": "POST",
	"Access-Control-Allow-Headers": "Content-Type",
	"Access-Control-Max-Age": "600",
	Vary: "Origin",
});

const answer = (
	env: CloudEnv,
	status: number,
	body: unknown,
	cors: boolean,
): Response =>
	Response.json(body, {
		status,
		headers: {
			"Cache-Control": "no-store",
			...(cors ? corsHeaders(env) : {}),
		},
	});

/** `POST /v1/billing/checkout` (and its preflight) on the API host. Only the ledger host's pages may call it from a browser. */
export const checkoutRoute = async (
	request: Request,
	env: CloudEnv,
	fetcher: typeof fetch = fetch,
): Promise<Response> => {
	const origin = request.headers.get("Origin");
	const allowedOrigin = `https://${env.LEDGER_HOST}`;
	if (origin !== null && origin !== allowedOrigin)
		return answer(
			env,
			403,
			{ error: { code: "origin", message: "Not allowed." } },
			false,
		);
	const cors = origin !== null;
	if (request.method === "OPTIONS")
		return new Response(null, { status: 204, headers: corsHeaders(env) });
	if (request.method !== "POST")
		return answer(
			env,
			405,
			{ error: { code: "method", message: "POST only." } },
			cors,
		);
	const client = request.headers.get("CF-Connecting-IP") ?? "unknown";
	if (!allowCheckout(client, Date.now()))
		return answer(
			env,
			429,
			{ error: { code: "rate_limited", message: "Try again in a minute." } },
			cors,
		);
	const tooLarge = (): Response =>
		answer(
			env,
			413,
			{ error: { code: "too_large", message: "Too large." } },
			cors,
		);
	if (Number(request.headers.get("Content-Length") ?? 0) > MAX_BODY_BYTES)
		return tooLarge();
	const text = await request.text();
	if (encoder.encode(text).byteLength > MAX_BODY_BYTES) return tooLarge();
	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		body = null;
	}
	const parsed = parseCheckoutRequest(body);
	if (!parsed.ok)
		return answer(
			env,
			parsed.status,
			{ error: { code: parsed.code, message: parsed.message } },
			cors,
		);
	try {
		const session = await createCheckoutSession(env, parsed.request, fetcher);
		return answer(env, 200, session, cors);
	} catch (error) {
		console.error(
			`checkout: ${error instanceof Error ? error.message : String(error)}`,
		);
		return answer(
			env,
			503,
			{
				error: {
					code: "unavailable",
					message: "Checkout is not available right now.",
				},
			},
			cors,
		);
	}
};
