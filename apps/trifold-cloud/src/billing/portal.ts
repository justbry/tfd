import type { CloudEnv } from "../env";
import { type ApiAnswer, browserApiRoute } from "./checkout";
import { publishedSchool, SCHOOL_IDS } from "./plans";
import { StripeError, stripeApi } from "./stripe";

/** A test-mode Checkout Session id, as Stripe puts it on the success URL. */
export const SESSION_ID = /^cs_test_[A-Za-z0-9]{10,250}$/;
/**
 * How long a Checkout Session id opens the portal. Until sign-in exists (PLAN.md M2) the id on the success URL is
 * what says who the buyer is, so it should not work forever from a browser's history.
 */
export const PORTAL_SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

const refuse = (status: number, code: string, message: string): ApiAnswer => ({
	status,
	body: { error: { code, message } },
});

/** Checks the body of `POST /v1/billing/portal`: `{ session_id: "cs_test_…" }`, nothing else. */
export const parsePortalRequest = (
	body: unknown,
): { ok: true; sessionId: string } | { ok: false; answer: ApiAnswer } => {
	if (!body || typeof body !== "object" || Array.isArray(body))
		return {
			ok: false,
			answer: refuse(400, "bad_request", "Send a JSON object."),
		};
	const { session_id: sessionId, ...rest } = body as Record<string, unknown>;
	if (Object.keys(rest).length > 0 || typeof sessionId !== "string")
		return {
			ok: false,
			answer: refuse(400, "bad_request", "Send { session_id }."),
		};
	if (!SESSION_ID.test(sessionId))
		return {
			ok: false,
			answer: refuse(400, "bad_session", "That is not a checkout session."),
		};
	return { ok: true, sessionId };
};

/**
 * A billing portal session for the customer of a completed Trifold checkout. The customer comes from the Checkout
 * Session, read from Stripe with the Worker's key: the browser only names the session, never a customer. The session
 * must be complete, Trifold's (`b4u_school` is a Trifold school) and under a day old.
 */
export const createPortalSession = async (
	env: CloudEnv,
	sessionId: string,
	fetcher: typeof fetch,
	nowMs: number,
): Promise<ApiAnswer> => {
	const call = (
		method: "GET" | "POST",
		path: string,
		params?: Record<string, string>,
	) =>
		stripeApi({
			key: env.STRIPE_SECRET_KEY,
			fetcher,
			method,
			path,
			...(params ? { params } : {}),
		});
	let session: Record<string, unknown>;
	try {
		session = await call("GET", `/v1/checkout/sessions/${sessionId}`);
	} catch (error) {
		if (error instanceof StripeError && error.status === 404)
			return refuse(404, "no_session", "No such checkout.");
		throw error;
	}
	const school = (session.metadata as { b4u_school?: unknown } | null)
		?.b4u_school;
	if (typeof school !== "string" || !SCHOOL_IDS.includes(school))
		return refuse(404, "no_session", "No such checkout.");
	if (session.status !== "complete" || typeof session.customer !== "string")
		return refuse(409, "not_complete", "This checkout is not complete.");
	const created = Number(session.created) * 1000;
	if (!(nowMs - created < PORTAL_SESSION_WINDOW_MS))
		return refuse(
			410,
			"session_expired",
			"This link has expired: it opens the billing portal for a day after checkout.",
		);
	const configuration = publishedSchool(school)?.portalConfiguration;
	if (!configuration)
		throw new Error(`no portal configuration is published for ${school}`);
	const portal = await call("POST", "/v1/billing_portal/sessions", {
		customer: session.customer,
		configuration,
		return_url: `https://${env.LEDGER_HOST}/billing/success?session_id=${sessionId}`,
	});
	if (typeof portal.url !== "string")
		throw new Error("Stripe answered a portal session with no URL");
	return { status: 200, body: { url: portal.url } };
};

/** `POST /v1/billing/portal` (and its preflight) on the API host, called by the success page's "Manage your plan". */
export const portalRoute = (
	request: Request,
	env: CloudEnv,
	fetcher: typeof fetch = fetch,
	nowMs: () => number = Date.now,
): Promise<Response> =>
	browserApiRoute(request, env, "portal", async (body) => {
		const parsed = parsePortalRequest(body);
		if (!parsed.ok) return parsed.answer;
		try {
			return await createPortalSession(env, parsed.sessionId, fetcher, nowMs());
		} catch (error) {
			console.error(
				`portal: ${error instanceof Error ? error.message : String(error)}`,
			);
			return refuse(
				503,
				"unavailable",
				"The billing portal is not available right now.",
			);
		}
	});
