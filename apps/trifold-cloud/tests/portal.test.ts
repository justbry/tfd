import { beforeEach, describe, expect, test } from "bun:test";
import { resetCheckoutLimit } from "../src/billing/checkout";
import { PUBLISHED } from "../src/billing/plans";
import { parsePortalRequest, portalRoute } from "../src/billing/portal";
import worker from "../src/index";
import { fakeEnv, fakeStripeApi, type StripeRoute } from "./fakes";

const API = "staging-api.trifold.app";
const LEDGER = "staging-ledger.trifold.app";
const ORIGIN = `https://${LEDGER}`;
const SESSION = "cs_test_a1portal0123456789";
const NOW = Date.parse("2026-11-08T16:00:00Z");
const CREATED = Math.floor(NOW / 1000) - 600;

beforeEach(() => resetCheckoutLimit());

const env = (key: string | null = "rk_test_unit") => ({
	...fakeEnv(),
	STRIPE_SECRET_KEY: key ?? undefined,
});

/** Stripe with one Checkout Session (overridable) and a portal session create. */
const stripeWith =
	(session: Record<string, unknown> = {}): StripeRoute =>
	({ method, url }) => {
		if (method === "GET" && url.pathname === `/v1/checkout/sessions/${SESSION}`)
			return {
				body: {
					id: SESSION,
					object: "checkout.session",
					livemode: false,
					mode: "subscription",
					status: "complete",
					customer: "cus_portal_1",
					created: CREATED,
					metadata: { b4u_school: "tf-std", family_id: "tfa_x" },
					...session,
				},
			};
		if (method === "POST" && url.pathname === "/v1/billing_portal/sessions")
			return {
				body: {
					id: "bps_1",
					livemode: false,
					url: "https://billing.stripe.com/p/session/test_1",
				},
			};
		return null;
	};

const post = (body: unknown, origin: string | null = ORIGIN) =>
	new Request(`https://${API}/v1/billing/portal`, {
		method: "POST",
		body: JSON.stringify(body),
		headers: {
			"Content-Type": "application/json",
			...(origin ? { Origin: origin } : {}),
		},
	});

describe("POST /v1/billing/portal", () => {
	test("finds the customer from the completed Checkout Session at Stripe, and opens the school's portal for it", async () => {
		const stripe = fakeStripeApi(stripeWith());
		const response = await portalRoute(
			post({ session_id: SESSION }),
			env(),
			stripe.fetcher,
			() => NOW,
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			url: "https://billing.stripe.com/p/session/test_1",
		});
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
		const create = stripe.calls.find(
			(call) => call.path === "/v1/billing_portal/sessions",
		);
		expect(Object.fromEntries(create?.params ?? [])).toEqual({
			customer: "cus_portal_1",
			configuration: PUBLISHED.schools["tf-std"]?.portalConfiguration,
			return_url: `https://${LEDGER}/billing/success?session_id=${SESSION}`,
		});
	});

	test("a customer id from the browser is refused: only a session id is taken", () => {
		for (const body of [
			{ customer: "cus_someone" },
			{ session_id: SESSION, customer: "cus_someone" },
			{ session_id: "cs_live_a1portal0123456789" },
			{ session_id: "../v1/customers" },
			[],
			null,
		])
			expect(parsePortalRequest(body).ok).toBe(false);
	});

	test("a session that is not complete, not Trifold's, unknown or over a day old opens no portal", async () => {
		const cases: [Record<string, unknown>, number][] = [
			[{ status: "open", customer: null }, 409],
			[{ metadata: { b4u_school: "someone-else" } }, 404],
			[{ metadata: {} }, 404],
			[{ created: Math.floor(NOW / 1000) - 25 * 3600 }, 410],
		];
		for (const [session, status] of cases) {
			const stripe = fakeStripeApi(stripeWith(session));
			const response = await portalRoute(
				post({ session_id: SESSION }),
				env(),
				stripe.fetcher,
				() => NOW,
			);
			expect(response.status).toBe(status);
			expect(
				stripe.calls.some(
					(call) => call.path === "/v1/billing_portal/sessions",
				),
			).toBe(false);
		}
		const unknown = await portalRoute(
			post({ session_id: "cs_test_unknown0123456789" }),
			env(),
			fakeStripeApi(stripeWith()).fetcher,
			() => NOW,
		);
		expect(unknown.status).toBe(404);
	});

	test("no key, a live key and a live-mode answer are a 503 with no detail; another origin is refused before Stripe", async () => {
		for (const key of [null, "sk_live_nope"]) {
			const stripe = fakeStripeApi(stripeWith());
			const response = await portalRoute(
				post({ session_id: SESSION }),
				env(key),
				stripe.fetcher,
				() => NOW,
			);
			expect(response.status).toBe(503);
			expect(JSON.stringify(await response.json())).not.toContain("live");
			expect(stripe.calls).toEqual([]);
		}
		const live = fakeStripeApi(stripeWith({ livemode: true }));
		expect(
			(
				await portalRoute(
					post({ session_id: SESSION }),
					env(),
					live.fetcher,
					() => NOW,
				)
			).status,
		).toBe(503);
		const foreign = fakeStripeApi(stripeWith());
		const refused = await portalRoute(
			post({ session_id: SESSION }, "https://evil.example"),
			env(),
			foreign.fetcher,
			() => NOW,
		);
		expect(refused.status).toBe(403);
		expect(foreign.calls).toEqual([]);
	});

	test("the portal API is routed on staging only", async () => {
		const staging = await worker.fetch(post({ session_id: "bad" }), env());
		expect(staging.status).toBe(400);
		const production = await worker.fetch(post({ session_id: SESSION }), {
			...env(),
			ENVIRONMENT: "production",
		});
		expect(production.status).toBe(404);
	});
});

describe("the success page", () => {
	const page = (query: string) =>
		worker.fetch(
			new Request(`https://${LEDGER}/billing/success${query}`),
			env(),
		);

	test("with a Checkout Session id it offers Manage your plan, which calls the portal API with that id", async () => {
		const response = await page(`?session_id=${SESSION}`);
		const html = await response.text();
		expect(html).toContain("Manage your plan");
		expect(html).toContain(`data-session="${SESSION}"`);
		expect(html).toContain(`data-endpoint="https://${API}/v1/billing/portal"`);
		expect(html).toContain('src="/billing/success.js"');
		const script = await worker.fetch(
			new Request(`https://${LEDGER}/billing/success.js`),
			env(),
		);
		expect(script.status).toBe(200);
		expect(await script.text()).toContain("session_id");
	});

	test("without one, or with one that is not a test session id, it offers no portal and echoes nothing", async () => {
		for (const query of [
			"",
			"?session_id=%3Cscript%3E",
			"?session_id=cs_live_a1portal0123456789",
		]) {
			const html = await (await page(query)).text();
			expect(html).not.toContain("Manage your plan");
			expect(html).not.toContain("<script>");
			expect(html).not.toContain("cs_live_");
		}
	});
});
