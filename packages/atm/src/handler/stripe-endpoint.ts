/**
 * The Stripe webhook endpoint `handleStripeWebhook` reads, and the steps to move a school onto it (D12 decision 10:
 * tfd owns the clover version, so a caller never names it).
 *
 * tfd reads one Stripe API version, `2025-10-29.clover` (`mappingFor` refuses any other). An endpoint's version decides
 * the shape of every event it sends and cannot be changed, so a school on another version gets a second endpoint at
 * clover, both stay enabled for a while, and the old one is retired once the new one runs cleanly (the two-endpoint
 * method, `plans/credits-engine/plan.md` §4):
 *
 * 1. `createCloverEndpoint` on the school's own Stripe account (its key, never the platform's), at the caller's URL with
 *    `v=clover` added, so the route can tell the two endpoints apart and pick the right signing secret. Store the
 *    `secret` it returns: Stripe shows it only once.
 * 2. `checkCloverEndpoint(await retrieveWebhookEndpoint(...))` before relying on it.
 * 3. `retireWebhookEndpoint` on the old one, `disable` or `delete`. It refuses an endpoint at clover, so the live
 *    endpoint is never the one retired by mistake.
 *
 * Every call goes through the `fetch` the caller passes (default `globalThis.fetch`) with the caller's secret or
 * restricted key (Webhook Endpoints: write). Nothing here reads the clock, the environment or a stored key. A Stripe
 * error is thrown as a `StripeEndpointError` naming the status and Stripe's own code and message, never the key.
 */
import type {
	CloverEndpointCheck,
	CreateCloverEndpointInput,
	CreatedWebhookEndpoint,
	StripeAccountAccess,
	WebhookEndpointInfo,
} from "../types.js";

/** The Stripe API version every tfd mapping reads. */
export const STRIPE_WEBHOOK_API_VERSION = "2025-10-29.clover";

/**
 * Every event type the handler takes, and so every type a school's endpoint must send. An endpoint that sends more
 * gets 200 `ignored` for the rest; one that sends fewer silently misses money or credits.
 */
export const STRIPE_WEBHOOK_EVENTS = [
	"invoice.paid",
	"invoice_payment.paid",
	"customer.subscription.created",
	"customer.subscription.updated",
	"customer.subscription.deleted",
	"charge.refunded",
	"charge.dispute.created",
	"charge.dispute.closed",
	"payout.paid",
	"payout.failed",
] as const;

/** The query parameter `createCloverEndpoint` adds to the endpoint's URL, so the route knows which endpoint called. */
export const CLOVER_ENDPOINT_PARAM = { name: "v", value: "clover" } as const;

const STRIPE_API = "https://api.stripe.com/v1/webhook_endpoints";
const WILDCARD_EVENT = "*";

export class StripeEndpointError extends Error {
	readonly status: number;
	readonly code: string | null;
	constructor(message: string, status: number, code: string | null) {
		super(message);
		this.name = "StripeEndpointError";
		this.status = status;
		this.code = code;
	}
}

/** The caller's endpoint URL with `v=clover` set (an existing `v` is replaced); any other query parameter is kept. */
export const cloverEndpointUrl = (url: string): string => {
	const parsed = new URL(url);
	if (parsed.protocol !== "https:")
		throw new Error(`a Stripe webhook endpoint must be https, got ${url}`);
	parsed.searchParams.set(
		CLOVER_ENDPOINT_PARAM.name,
		CLOVER_ENDPOINT_PARAM.value,
	);
	return parsed.toString();
};

type StripeObject = Record<string, unknown>;

const textOrNull = (value: unknown): string | null =>
	typeof value === "string" ? value : null;

const endpointOf = (object: StripeObject): WebhookEndpointInfo => ({
	id: String(object.id),
	url: String(object.url),
	apiVersion: textOrNull(object.api_version),
	status: textOrNull(object.status),
	enabledEvents: Array.isArray(object.enabled_events)
		? object.enabled_events.map(String)
		: [],
	metadata: Object.fromEntries(
		Object.entries((object.metadata as StripeObject | null) ?? {}).map(
			([key, value]) => [key, String(value)],
		),
	),
});

const call = async (
	access: StripeAccountAccess,
	method: "GET" | "POST" | "DELETE",
	path: string,
	options: { form?: URLSearchParams; idempotencyKey?: string } = {},
): Promise<StripeObject> => {
	if (typeof access.secretKey !== "string" || access.secretKey === "")
		throw new Error("a Stripe secret or restricted key is required");
	const headers: Record<string, string> = {
		Authorization: `Bearer ${access.secretKey}`,
		"Stripe-Version": STRIPE_WEBHOOK_API_VERSION,
	};
	if (options.form)
		headers["Content-Type"] = "application/x-www-form-urlencoded";
	if (options.idempotencyKey)
		headers["Idempotency-Key"] = options.idempotencyKey;
	const response = await (access.fetch ?? globalThis.fetch)(
		`${STRIPE_API}${path}`,
		{ method, headers, body: options.form?.toString() },
	);
	const body = (await response.json().catch(() => ({}))) as StripeObject;
	if (!response.ok) {
		const error = (body.error as StripeObject | undefined) ?? {};
		const code = textOrNull(error.code) ?? textOrNull(error.type);
		const message = textOrNull(error.message) ?? response.statusText;
		throw new StripeEndpointError(
			`Stripe refused ${method} ${STRIPE_API}${path} (${response.status}${code ? ` ${code}` : ""}): ${message}`,
			response.status,
			code,
		);
	}
	return body;
};

const endpointPath = (id: string): string => {
	if (!/^we_[A-Za-z0-9]+$/.test(id))
		throw new Error(`not a webhook endpoint id: ${JSON.stringify(id)}`);
	return `/${id}`;
};

/**
 * Creates the school's endpoint at clover with every event the handler takes, at `url` plus `v=clover`. Returns its id
 * and signing secret. Pass an `idempotencyKey` (Stripe keeps one for 24 hours) so a retried create makes one endpoint.
 */
export const createCloverEndpoint = async (
	input: CreateCloverEndpointInput,
): Promise<CreatedWebhookEndpoint> => {
	const form = new URLSearchParams();
	form.set("url", cloverEndpointUrl(input.url));
	form.set("api_version", STRIPE_WEBHOOK_API_VERSION);
	for (const type of STRIPE_WEBHOOK_EVENTS)
		form.append("enabled_events[]", type);
	if (input.description) form.set("description", input.description);
	for (const [key, value] of Object.entries(input.metadata ?? {}))
		form.set(`metadata[${key}]`, value);
	const created = await call(input, "POST", "", {
		form,
		idempotencyKey: input.idempotencyKey,
	});
	const secret = textOrNull(created.secret);
	if (secret === null)
		throw new Error(
			`Stripe created webhook endpoint ${String(created.id)} but returned no signing secret`,
		);
	return { ...endpointOf(created), secret };
};

/** The endpoint as Stripe has it now (no secret: Stripe returns it only at creation). */
export const retrieveWebhookEndpoint = async (
	input: StripeAccountAccess & { id: string },
): Promise<WebhookEndpointInfo> =>
	endpointOf(await call(input, "GET", endpointPath(input.id)));

/**
 * Whether an endpoint is one the handler can be served from: at clover, enabled, sending every handled event type (or
 * every type), with `v=clover` on its URL. Each problem is named.
 */
export const checkCloverEndpoint = (
	endpoint: WebhookEndpointInfo,
): CloverEndpointCheck => {
	const problems: string[] = [];
	if (endpoint.apiVersion !== STRIPE_WEBHOOK_API_VERSION)
		problems.push(
			`endpoint ${endpoint.id} is at API version ${endpoint.apiVersion ?? "(the account's default)"}, not ${STRIPE_WEBHOOK_API_VERSION}`,
		);
	if (endpoint.status !== "enabled")
		problems.push(
			`endpoint ${endpoint.id} is ${endpoint.status ?? "in no known state"}, not enabled`,
		);
	const sendsAll = endpoint.enabledEvents.includes(WILDCARD_EVENT);
	const missing = sendsAll
		? []
		: STRIPE_WEBHOOK_EVENTS.filter(
				(type) => !endpoint.enabledEvents.includes(type),
			);
	if (missing.length > 0)
		problems.push(
			`endpoint ${endpoint.id} does not send ${missing.join(", ")}`,
		);
	const param = URL.canParse(endpoint.url)
		? new URL(endpoint.url).searchParams.get(CLOVER_ENDPOINT_PARAM.name)
		: null;
	if (param !== CLOVER_ENDPOINT_PARAM.value)
		problems.push(
			`endpoint ${endpoint.id}'s URL has no ${CLOVER_ENDPOINT_PARAM.name}=${CLOVER_ENDPOINT_PARAM.value}, so the route cannot tell it from the old endpoint`,
		);
	return problems.length === 0
		? { ok: true, endpoint, missingEvents: [] }
		: { ok: false, endpoint, missingEvents: missing, problems };
};

/**
 * Retires the school's old endpoint once the clover one runs cleanly: `disable` (Stripe stops sending; it can be
 * enabled again) or `delete` (gone, with its pending retries). Refuses an endpoint at clover, so the live one is never
 * retired by mistake. Returns the endpoint as it was before the change.
 */
export const retireWebhookEndpoint = async (
	input: StripeAccountAccess & { id: string; action: "disable" | "delete" },
): Promise<WebhookEndpointInfo> => {
	const before = await retrieveWebhookEndpoint(input);
	if (before.apiVersion === STRIPE_WEBHOOK_API_VERSION)
		throw new Error(
			`endpoint ${before.id} is at ${STRIPE_WEBHOOK_API_VERSION}, the version tfd reads: it is not the old endpoint`,
		);
	if (input.action === "delete") {
		const deleted = await call(input, "DELETE", endpointPath(input.id));
		if (deleted.deleted !== true)
			throw new Error(`Stripe did not delete webhook endpoint ${before.id}`);
	} else {
		const form = new URLSearchParams({ disabled: "true" });
		await call(input, "POST", endpointPath(input.id), { form });
	}
	return before;
};
