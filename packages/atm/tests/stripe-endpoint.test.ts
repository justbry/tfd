/**
 * The school's clover webhook endpoint (D12 decision 10): its settings, and the two-endpoint handover through an injected
 * `fetch`. No network: a fake Stripe answers in the shape of Stripe's webhook endpoint object (API 2025-10-29.clover).
 */
import { describe, expect, test } from "bun:test";
import {
	CLOVER_ENDPOINT_PARAM,
	checkCloverEndpoint,
	cloverEndpointUrl,
	createCloverEndpoint,
	retireWebhookEndpoint,
	retrieveWebhookEndpoint,
	STRIPE_WEBHOOK_API_VERSION,
	STRIPE_WEBHOOK_EVENTS,
	StripeEndpointError,
} from "../src/index.js";
import type { WebhookEndpointInfo } from "../src/types.js";

// Built at run time, so no key-shaped literal sits in the source.
const KEY = ["rk", "test", "school", "fake"].join("_");
const ROUTE = "https://family.example/hooks/stripe/school?school=sch_vol";

type Seen = {
	method: string;
	url: string;
	headers: Record<string, string>;
	body: URLSearchParams;
};

/** A Stripe that keeps endpoints in memory and records every request it sees. */
const fakeStripe = (start: Record<string, Record<string, unknown>> = {}) => {
	const endpoints = new Map(Object.entries(start));
	const seen: Seen[] = [];
	let next = 1;
	const reply = (status: number, body: unknown) =>
		new Response(JSON.stringify(body), {
			status,
			headers: { "Content-Type": "application/json" },
		});
	const missing = (id: string) =>
		reply(404, {
			error: {
				type: "invalid_request_error",
				code: "resource_missing",
				message: `No such webhook endpoint: '${id}'`,
			},
		});
	const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? "GET";
		const headers = init?.headers as Record<string, string>;
		const body = new URLSearchParams(String(init?.body ?? ""));
		seen.push({ method, url, headers, body });
		if (headers.Authorization !== `Bearer ${KEY}`)
			return reply(401, {
				error: {
					type: "invalid_request_error",
					message: "Invalid API Key provided",
				},
			});
		const id = new URL(url).pathname.split("/")[3];
		if (method === "POST" && !id) {
			const created = {
				id: `we_fake${next++}`,
				object: "webhook_endpoint",
				api_version: body.get("api_version"),
				url: body.get("url"),
				status: "enabled",
				enabled_events: body.getAll("enabled_events[]"),
				description: body.get("description"),
				metadata: Object.fromEntries(
					[...body.entries()]
						.filter(([key]) => key.startsWith("metadata["))
						.map(([key, value]) => [key.slice(9, -1), value]),
				),
				livemode: false,
				secret: `whsec_fake${next}`,
			};
			const { secret: _secret, ...stored } = created;
			endpoints.set(created.id, stored);
			return reply(200, created);
		}
		const endpoint = id ? endpoints.get(id) : undefined;
		if (!id || !endpoint) return missing(String(id));
		if (method === "GET") return reply(200, endpoint);
		if (method === "DELETE") {
			endpoints.delete(id);
			return reply(200, { id, object: "webhook_endpoint", deleted: true });
		}
		if (body.get("disabled") === "true") endpoint.status = "disabled";
		return reply(200, endpoint);
	}) as typeof globalThis.fetch;
	return { fetch, seen, endpoints };
};

const ACACIA = {
	we_old1: {
		id: "we_old1",
		object: "webhook_endpoint",
		api_version: "2025-02-24.acacia",
		url: ROUTE,
		status: "enabled",
		enabled_events: [
			"invoice.paid",
			"customer.subscription.created",
			"customer.subscription.updated",
			"customer.subscription.deleted",
			"charge.refunded",
			"charge.dispute.closed",
		],
		metadata: {},
	},
};

describe("the endpoint settings", () => {
	test("clover, and the ten event types the handler takes", () => {
		expect(STRIPE_WEBHOOK_API_VERSION).toBe("2025-10-29.clover");
		expect([...STRIPE_WEBHOOK_EVENTS].sort()).toEqual([
			"charge.dispute.closed",
			"charge.dispute.created",
			"charge.refunded",
			"customer.subscription.created",
			"customer.subscription.deleted",
			"customer.subscription.updated",
			"invoice.paid",
			"invoice_payment.paid",
			"payout.failed",
			"payout.paid",
		]);
	});

	test("the URL gets v=clover, keeps the school, replaces an old v and refuses plain http", () => {
		expect(cloverEndpointUrl(ROUTE)).toBe(`${ROUTE}&v=clover`);
		expect(cloverEndpointUrl(`${ROUTE}&v=acacia`)).toBe(`${ROUTE}&v=clover`);
		expect(CLOVER_ENDPOINT_PARAM).toEqual({ name: "v", value: "clover" });
		expect(() => cloverEndpointUrl("http://family.example/hooks")).toThrow(
			/must be https/,
		);
	});
});

describe("createCloverEndpoint", () => {
	test("creates the endpoint on the school's account at clover with every event, and returns its id and secret", async () => {
		const stripe = fakeStripe();
		const created = await createCloverEndpoint({
			secretKey: KEY,
			fetch: stripe.fetch,
			url: ROUTE,
			description: "tfd, school sch_vol",
			metadata: { school: "sch_vol" },
			idempotencyKey: "tfd:endpoint:sch_vol:clover",
		});
		expect(created).toEqual({
			id: "we_fake1",
			url: `${ROUTE}&v=clover`,
			apiVersion: "2025-10-29.clover",
			status: "enabled",
			enabledEvents: [...STRIPE_WEBHOOK_EVENTS],
			metadata: { school: "sch_vol" },
			secret: "whsec_fake2",
		});
		const [request] = stripe.seen;
		expect(request?.method).toBe("POST");
		expect(request?.url).toBe("https://api.stripe.com/v1/webhook_endpoints");
		expect(request?.headers).toMatchObject({
			"Stripe-Version": "2025-10-29.clover",
			"Idempotency-Key": "tfd:endpoint:sch_vol:clover",
			"Content-Type": "application/x-www-form-urlencoded",
		});
		expect(request?.body.get("api_version")).toBe("2025-10-29.clover");
		expect(checkCloverEndpoint(created).ok).toBe(true);
	});

	test("a Stripe refusal is a StripeEndpointError with Stripe's code, and never shows the key", async () => {
		const stripe = fakeStripe();
		const wrongKey = ["rk", "test", "other"].join("_");
		const error = await createCloverEndpoint({
			secretKey: wrongKey,
			fetch: stripe.fetch,
			url: ROUTE,
		}).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(StripeEndpointError);
		expect((error as InstanceType<typeof StripeEndpointError>).status).toBe(
			401,
		);
		expect((error as Error).message).toContain("invalid_request_error");
		expect((error as Error).message).not.toContain(wrongKey);
	});

	test("no key, no call", async () => {
		const stripe = fakeStripe();
		await expect(
			createCloverEndpoint({ secretKey: "", fetch: stripe.fetch, url: ROUTE }),
		).rejects.toThrow(/key is required/);
		expect(stripe.seen).toHaveLength(0);
	});
});

describe("checkCloverEndpoint", () => {
	const good: WebhookEndpointInfo = {
		id: "we_1",
		url: `${ROUTE}&v=clover`,
		apiVersion: "2025-10-29.clover",
		status: "enabled",
		enabledEvents: [...STRIPE_WEBHOOK_EVENTS],
		metadata: {},
	};

	test("an endpoint that sends every type ('*') is fine too", () => {
		expect(checkCloverEndpoint({ ...good, enabledEvents: ["*"] }).ok).toBe(
			true,
		);
	});

	test("the old endpoint fails on each count, naming the missing events", async () => {
		const stripe = fakeStripe(structuredClone(ACACIA));
		const old = await retrieveWebhookEndpoint({
			secretKey: KEY,
			fetch: stripe.fetch,
			id: "we_old1",
		});
		const check = checkCloverEndpoint({ ...old, status: "disabled" });
		expect(check.ok).toBe(false);
		if (check.ok) return;
		expect(check.missingEvents).toEqual([
			"invoice_payment.paid",
			"charge.dispute.created",
			"payout.paid",
			"payout.failed",
		]);
		expect(check.problems).toHaveLength(4);
		expect(check.problems[0]).toContain("2025-02-24.acacia");
		expect(check.problems[1]).toContain("disabled");
		expect(check.problems[3]).toContain("v=clover");
	});
});

describe("the two-endpoint handover", () => {
	test("create clover beside acacia, check it, then disable or delete the old one", async () => {
		const stripe = fakeStripe(structuredClone(ACACIA));
		const access = { secretKey: KEY, fetch: stripe.fetch };
		const created = await createCloverEndpoint({ ...access, url: ROUTE });
		expect(stripe.endpoints.size).toBe(2);
		const now = await retrieveWebhookEndpoint({ ...access, id: created.id });
		expect(checkCloverEndpoint(now).ok).toBe(true);

		const disabled = await retireWebhookEndpoint({
			...access,
			id: "we_old1",
			action: "disable",
		});
		expect(disabled.status).toBe("enabled");
		expect(stripe.endpoints.get("we_old1")?.status).toBe("disabled");

		await retireWebhookEndpoint({ ...access, id: "we_old1", action: "delete" });
		expect([...stripe.endpoints.keys()]).toEqual([created.id]);
		expect(stripe.seen.at(-1)?.method).toBe("DELETE");
	});

	test("the clover endpoint is never the one retired", async () => {
		const stripe = fakeStripe();
		const access = { secretKey: KEY, fetch: stripe.fetch };
		const created = await createCloverEndpoint({ ...access, url: ROUTE });
		await expect(
			retireWebhookEndpoint({ ...access, id: created.id, action: "delete" }),
		).rejects.toThrow(/not the old endpoint/);
		expect(stripe.endpoints.has(created.id)).toBe(true);
	});

	test("an unknown endpoint is Stripe's 404, and an id that is not an endpoint's is refused before any call", async () => {
		const stripe = fakeStripe();
		const access = { secretKey: KEY, fetch: stripe.fetch };
		await expect(
			retrieveWebhookEndpoint({ ...access, id: "we_gone" }),
		).rejects.toThrow(/404 resource_missing/);
		const before = stripe.seen.length;
		await expect(
			retireWebhookEndpoint({
				...access,
				id: "../customers",
				action: "delete",
			}),
		).rejects.toThrow(/not a webhook endpoint id/);
		expect(stripe.seen).toHaveLength(before);
	});
});
