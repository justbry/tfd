import type { CloudEnv } from "../env";
import { TRIFOLD_BOOKS } from "../org-do";
import { SCHOOL_IDS } from "./plans";
import { verifyStripeSignature } from "./stripe-signature";

/** Stripe's events are small; anything larger is not one of them (PLAN.md section 3.3). */
export const MAX_WEBHOOK_BYTES = 256 * 1024;

const reply = (status: number, body: unknown): Response =>
	Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

const metadataSchool = (metadata: unknown): string | null => {
	const school = (metadata as { b4u_school?: unknown } | null)?.b4u_school;
	return typeof school === "string" && SCHOOL_IDS.includes(school)
		? school
		: null;
};

/** The Trifold school an event names, from the metadata checkout put on the subscription (and so on its invoices). */
export const schoolHintOf = (event: unknown): string | null => {
	const object = (event as { data?: { object?: Record<string, unknown> } })
		?.data?.object;
	if (!object) return null;
	const parent = object.parent as
		| { subscription_details?: { metadata?: unknown } }
		| null
		| undefined;
	return (
		metadataSchool(object.metadata) ??
		metadataSchool(parent?.subscription_details?.metadata) ??
		metadataSchool(
			(object.subscription_details as { metadata?: unknown } | undefined)
				?.metadata,
		)
	);
};

/**
 * `POST /webhooks/billing` on the API host: Trifold's own subscriptions (PLAN.md section 5), on the platform account's
 * endpoint with its own secret. Verifies Stripe's signature on the raw body, then hands the event to the `trifold`
 * Durable Object, which applies it with tfd's handler and ships the outbox. Answers 2xx only once the DO has committed
 * it, and the handler's own status otherwise (409 and 5xx are retried by Stripe).
 */
export const billingWebhookRoute = async (
	request: Request,
	env: CloudEnv,
	nowMs: number = Date.now(),
): Promise<Response> => {
	if (request.method !== "POST")
		return reply(405, { error: { code: "method", message: "POST only." } });
	const secret = env.STRIPE_BILLING_WEBHOOK_SECRET;
	if (!secret) {
		console.error("billing webhook: STRIPE_BILLING_WEBHOOK_SECRET is not set");
		return reply(503, { error: { code: "unavailable" } });
	}
	const declared = Number(request.headers.get("Content-Length") ?? 0);
	if (declared > MAX_WEBHOOK_BYTES)
		return reply(413, { error: { code: "too_large" } });
	const payload = await request.text();
	if (payload.length > MAX_WEBHOOK_BYTES)
		return reply(413, { error: { code: "too_large" } });
	const verdict = await verifyStripeSignature({
		payload,
		header: request.headers.get("Stripe-Signature"),
		secret,
		nowMs,
	});
	if (!verdict.ok)
		return reply(400, {
			error: { code: "bad_signature", reason: verdict.reason },
		});
	let event: { id?: unknown; livemode?: unknown };
	try {
		event = JSON.parse(payload);
	} catch {
		return reply(400, { error: { code: "bad_request" } });
	}
	// Environments never mix: staging applies test-mode events only, production live-mode only.
	const live = env.ENVIRONMENT === "production";
	if (event.livemode !== live)
		return reply(200, { outcome: "ignored", reason: "other_mode" });
	const stub = env.ORG.get(env.ORG.idFromName(TRIFOLD_BOOKS));
	try {
		const response = await stub.fetch(
			new Request("https://org.internal/billing/stripe", {
				method: "POST",
				body: payload,
				headers: { "X-School-Hint": schoolHintOf(event) ?? "" },
			}),
		);
		const body = (await response.json()) as {
			school?: string;
			handler?: { body?: unknown };
			shipped?: unknown;
		};
		return reply(response.status, {
			school: body.school ?? null,
			...(body.handler?.body as Record<string, unknown>),
			shipped: body.shipped ?? null,
		});
	} catch (error) {
		console.error(
			`billing webhook: the books DO failed on ${String(event.id)}: ${error instanceof Error ? error.message : String(error)}`,
		);
		return reply(503, { error: { code: "unavailable" } });
	}
};
