import { beforeEach, describe, expect, test } from "bun:test";
import { trifoldLookupKey } from "../../../catalog/trifold/check.ts";
import {
	checkoutForm,
	checkoutRoute,
	parseCheckoutRequest,
	resetCheckoutLimit,
} from "../src/billing/checkout";
import { PUBLISHED } from "../src/billing/plans";
import worker from "../src/index";
import { fakeEnv } from "./fakes";

const API = "staging-api.trifold.app";
const LEDGER = "staging-ledger.trifold.app";
const ORIGIN = `https://${LEDGER}`;
const ACCOUNT = "tfa_0123456789abcdef0123456789abcdef";
/** Not a real key: the shape staging accepts. */
const TEST_KEY = "sk_test_unit";

beforeEach(() => resetCheckoutLimit());

type Sent = { url: string; headers: Headers; form: URLSearchParams };

/** A Stripe that answers every Checkout Session create with a test-mode session, and records what it was sent. */
const fakeStripe = (answer: Record<string, unknown> = {}) => {
	const sent: Sent[] = [];
	const fetcher = (async (url: string, init: RequestInit) => {
		sent.push({
			url,
			headers: new Headers(init.headers),
			form: new URLSearchParams(init.body as URLSearchParams),
		});
		return Response.json({
			id: "cs_test_1",
			url: "https://checkout.stripe.com/c/pay/cs_test_1",
			livemode: false,
			...answer,
		});
	}) as unknown as typeof fetch;
	return { sent, fetcher };
};

const env = (key: string | null = TEST_KEY) => ({
	...fakeEnv(),
	STRIPE_SECRET_KEY: key ?? undefined,
});

const post = (
	body: unknown,
	headers: Record<string, string> = { Origin: ORIGIN },
) =>
	new Request(`https://${API}/v1/billing/checkout`, {
		method: "POST",
		body: typeof body === "string" ? body : JSON.stringify(body),
		headers: { "Content-Type": "application/json", ...headers },
	});

describe("checkout input", () => {
	test("Starter and Audited, std or np, month or year, are sold", () => {
		for (const tier of ["starter", "audited"])
			for (const org of ["std", "np"])
				for (const interval of ["month", "year"])
					expect(parseCheckoutRequest({ tier, org, interval }).ok).toBe(true);
	});

	test("Pro is refused as not on sale; unknown tiers, intervals, orgs, emails and fields are refused", () => {
		const code = (body: unknown) => {
			const parsed = parseCheckoutRequest(body);
			return parsed.ok ? "ok" : parsed.code;
		};
		expect(code({ tier: "pro", org: "std", interval: "month" })).toBe(
			"tier_not_sold",
		);
		expect(code({ tier: "free", org: "std", interval: "month" })).toBe(
			"unknown_tier",
		);
		expect(code({ tier: "../x", org: "std", interval: "month" })).toBe(
			"unknown_tier",
		);
		expect(code({ tier: "starter", org: "std", interval: "week" })).toBe(
			"bad_interval",
		);
		expect(code({ tier: "starter", org: "gov", interval: "month" })).toBe(
			"bad_org",
		);
		expect(
			code({
				tier: "starter",
				org: "std",
				interval: "month",
				email: "not an email",
			}),
		).toBe("bad_email");
		expect(
			code({
				tier: "starter",
				org: "std",
				interval: "month",
				email: `${"a".repeat(250)}@x.co`,
			}),
		).toBe("bad_email");
		expect(
			code({ tier: "starter", org: "std", interval: "month", price: 1 }),
		).toBe("bad_request");
		expect(code(["starter"])).toBe("bad_request");
		expect(code(null)).toBe("bad_request");
	});
});

describe("the Checkout Session's parameters", () => {
	test("subscription mode, the published price for the lookup key, tfd's metadata, return pages on the ledger host", () => {
		const form = checkoutForm(
			{ tier: "audited", interval: "year", org: "np", email: "a@b.org" },
			{ accountId: ACCOUNT, ledgerHost: LEDGER },
		);
		const lookupKey = trifoldLookupKey("np", "audited", "year");
		expect(lookupKey).toBe("b4u_tf-np_t_audited_year_79000_usd");
		const priceId = PUBLISHED.schools["tf-np"]?.priceIds[lookupKey];
		expect(priceId).toMatch(/^price_/);
		expect(form).toMatchObject({
			mode: "subscription",
			client_reference_id: ACCOUNT,
			"line_items[0][price]": priceId as string,
			"line_items[0][quantity]": "1",
			"metadata[b4u_school]": "tf-np",
			"metadata[family_id]": ACCOUNT,
			"metadata[tier_id]": "audited",
			"metadata[interval]": "year",
			"subscription_data[metadata][b4u_school]": "tf-np",
			"subscription_data[metadata][family_id]": ACCOUNT,
			"subscription_data[metadata][menu_version]": PUBLISHED.schools["tf-np"]
				?.menuVersion as string,
			success_url: `https://${LEDGER}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
			cancel_url: `https://${LEDGER}/billing/cancel`,
			customer_email: "a@b.org",
		});
		// No member code: Trifold's policy has none, so the buyer is offered no code box.
		expect(form.allow_promotion_codes).toBeUndefined();
	});

	test("every sold price is published, and the std menu publishes under tf-std", () => {
		for (const org of ["std", "np"] as const)
			for (const tier of ["starter", "audited"])
				for (const interval of ["month", "year"] as const) {
					const form = checkoutForm(
						{ tier, interval, org },
						{ accountId: ACCOUNT, ledgerHost: LEDGER },
					);
					expect(form["line_items[0][price]"]).toBe(
						PUBLISHED.schools[org === "std" ? "tf-std" : "tf-np"]?.priceIds[
							trifoldLookupKey(org, tier, interval)
						] as string,
					);
					expect(form.customer_email).toBeUndefined();
				}
	});
});

describe("POST /v1/billing/checkout", () => {
	test("creates the session at Stripe with the test key and answers its URL, with CORS for the ledger host", async () => {
		const stripe = fakeStripe();
		const response = await checkoutRoute(
			post({ tier: "starter", org: "std", interval: "month" }),
			env(),
			stripe.fetcher,
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			id: "cs_test_1",
			url: "https://checkout.stripe.com/c/pay/cs_test_1",
		});
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
		const [sent] = stripe.sent;
		expect(sent?.url).toBe("https://api.stripe.com/v1/checkout/sessions");
		expect(sent?.headers.get("Authorization")).toBe(`Bearer ${TEST_KEY}`);
		expect(sent?.headers.get("Stripe-Version")).toBe("2025-10-29.clover");
		const familyId = sent?.form.get("metadata[family_id]") as string;
		expect(familyId).toMatch(/^tfa_[0-9a-f]{32}$/);
		expect(sent?.form.get("subscription_data[metadata][family_id]")).toBe(
			familyId,
		);
		expect(sent?.headers.get("Idempotency-Key")).toBe(`checkout:${familyId}`);
	});

	test("each checkout gets its own account id", async () => {
		const stripe = fakeStripe();
		for (let index = 0; index < 2; index += 1)
			await checkoutRoute(
				post({ tier: "starter", org: "std", interval: "month" }),
				env(),
				stripe.fetcher,
			);
		const [first, second] = stripe.sent.map((sent) =>
			sent.form.get("metadata[family_id]"),
		);
		expect(first).not.toBe(second);
	});

	test("a preflight from the ledger host is allowed; another origin is refused before Stripe is called", async () => {
		const stripe = fakeStripe();
		const preflight = await checkoutRoute(
			new Request(`https://${API}/v1/billing/checkout`, {
				method: "OPTIONS",
				headers: { Origin: ORIGIN },
			}),
			env(),
			stripe.fetcher,
		);
		expect(preflight.status).toBe(204);
		expect(preflight.headers.get("Access-Control-Allow-Methods")).toBe("POST");
		const foreign = await checkoutRoute(
			post(
				{ tier: "starter", org: "std", interval: "month" },
				{ Origin: "https://evil.example" },
			),
			env(),
			stripe.fetcher,
		);
		expect(foreign.status).toBe(403);
		expect(foreign.headers.get("Access-Control-Allow-Origin")).toBeNull();
		expect(stripe.sent).toEqual([]);
	});

	test("bad input is a 400 that names the problem; Pro is a 400 tier_not_sold", async () => {
		const stripe = fakeStripe();
		const pro = await checkoutRoute(
			post({ tier: "pro", org: "std", interval: "month" }),
			env(),
			stripe.fetcher,
		);
		expect(pro.status).toBe(400);
		expect(((await pro.json()) as { error: { code: string } }).error.code).toBe(
			"tier_not_sold",
		);
		const broken = await checkoutRoute(post("{"), env(), stripe.fetcher);
		expect(broken.status).toBe(400);
		const large = await checkoutRoute(
			post({ tier: "x".repeat(3000) }),
			env(),
			stripe.fetcher,
		);
		expect(large.status).toBe(413);
		expect(stripe.sent).toEqual([]);
	});

	test("a missing or live key, a Stripe error and a live-mode answer are a 503 with no detail", async () => {
		const body = { tier: "starter", org: "std", interval: "month" };
		for (const key of [null, "sk_live_x", "rk_live_x"]) {
			const stripe = fakeStripe();
			const response = await checkoutRoute(
				post(body),
				env(key),
				stripe.fetcher,
			);
			expect(response.status).toBe(503);
			expect(stripe.sent).toEqual([]);
		}
		const live = fakeStripe({ livemode: true });
		expect((await checkoutRoute(post(body), env(), live.fetcher)).status).toBe(
			503,
		);
		const refused = (async () =>
			Response.json(
				{ error: { type: "invalid_request_error" } },
				{ status: 400 },
			)) as unknown as typeof fetch;
		const response = await checkoutRoute(post(body), env(), refused);
		expect(response.status).toBe(503);
		expect(await response.text()).not.toContain("invalid_request_error");
	});

	test("more than ten checkouts a minute from one address are a 429", async () => {
		const stripe = fakeStripe();
		const body = { tier: "starter", org: "std", interval: "month" };
		const statuses: number[] = [];
		for (let index = 0; index < 11; index += 1)
			statuses.push(
				(
					await checkoutRoute(
						post(body, { Origin: ORIGIN, "CF-Connecting-IP": "203.0.113.9" }),
						env(),
						stripe.fetcher,
					)
				).status,
			);
		expect(statuses.slice(0, 10).every((status) => status === 200)).toBe(true);
		expect(statuses[10]).toBe(429);
	});

	test("checkout and the billing pages are not served outside staging; the webhook is", async () => {
		const production = { ...env(), ENVIRONMENT: "production" as const };
		const checkout = await worker.fetch(
			post({ tier: "starter", org: "std", interval: "month" }),
			production,
		);
		expect(checkout.status).toBe(404);
		const plans = await worker.fetch(
			new Request(`https://${LEDGER}/billing/plans`),
			production,
		);
		expect(plans.status).toBe(404);
		const webhook = await worker.fetch(
			new Request(`https://${API}/webhooks/billing`, {
				method: "POST",
				body: "{}",
			}),
			production,
		);
		expect(webhook.status).toBe(503);
	});
});

describe("the staging billing pages", () => {
	const get = (path: string) =>
		worker.fetch(new Request(`https://${LEDGER}${path}`), env());

	test("plans shows Starter and Audited with both orgs' prices, calls the API host, and offers no Pro", async () => {
		const response = await get("/billing/plans");
		expect(response.status).toBe(200);
		const html = await response.text();
		expect(html).toContain("Starter");
		expect(html).toContain("Audited");
		expect(html).not.toContain(">Pro<");
		expect(html).toContain('data-price="std:month">$29<');
		expect(html).toContain('data-price="np:year">$790<');
		expect(html).toContain(
			`data-endpoint="https://${API}/v1/billing/checkout"`,
		);
		expect(html).toContain("test mode");
		expect(html).not.toMatch(/start free/i);
		const csp = response.headers.get("Content-Security-Policy") ?? "";
		expect(csp).toContain(`connect-src https://${API}`);
		expect(csp).toContain("script-src 'self'");
		expect(response.headers.get("X-Frame-Options")).toBe("DENY");
	});

	test("success, cancel and the page's assets answer; other paths stay 404", async () => {
		expect((await get("/billing/success?session_id=cs_test_1")).status).toBe(
			200,
		);
		expect(await (await get("/billing/cancel")).text()).toContain(
			"Nothing was charged",
		);
		expect(
			(await get("/billing/plans.js")).headers.get("Content-Type"),
		).toContain("javascript");
		expect((await get("/billing/billing.css")).status).toBe(200);
		expect((await get("/billing/nope")).status).toBe(404);
		const onApi = await worker.fetch(
			new Request(`https://${API}/billing/plans`),
			env(),
		);
		expect(onApi.status).toBe(404);
	});
});
