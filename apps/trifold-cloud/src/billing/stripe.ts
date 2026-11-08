import { PUBLISHED } from "./plans";

const STRIPE_API = "https://api.stripe.com";
/** A test-mode key: staging never holds a live one. */
export const TEST_KEY = /^(sk|rk)_test_/;

/** A Stripe answer that is not a 2xx, or a request that never got one. `status` 0: no answer, or no usable key. */
export class StripeError extends Error {
	readonly status: number;
	readonly code: string | null;
	constructor(message: string, status: number, code: string | null = null) {
		super(message);
		this.name = "StripeError";
		this.status = status;
		this.code = code;
	}
}

/** Throws on any Stripe object that says `livemode: true`, at any depth. */
const assertTestMode = (value: unknown, path: string): void => {
	if (!value || typeof value !== "object") return;
	if ((value as { livemode?: unknown }).livemode === true)
		throw new StripeError(`Stripe answered a live-mode object for ${path}`, 0);
	for (const inner of Object.values(value)) assertTestMode(inner, path);
};

/**
 * One call to Stripe's API with the Worker's key (test mode only), at the API version the publish and the handler use.
 * Refuses a missing or live key before any request, and any answer that holds a live-mode object.
 */
export const stripeApi = async (input: {
	key: string | undefined;
	fetcher: typeof fetch;
	method: "GET" | "POST";
	path: string;
	params?: Record<string, string> | readonly (readonly [string, string])[];
	idempotencyKey?: string;
}): Promise<Record<string, unknown>> => {
	const { key } = input;
	if (!key || !TEST_KEY.test(key))
		throw new StripeError(
			"STRIPE_SECRET_KEY is missing or not a test-mode key",
			0,
		);
	const form = new URLSearchParams(
		input.params as Record<string, string> | [string, string][] | undefined,
	);
	const get = input.method === "GET";
	const query = get && form.size > 0 ? `?${form}` : "";
	const response = await input.fetcher(`${STRIPE_API}${input.path}${query}`, {
		method: input.method,
		headers: {
			Authorization: `Bearer ${key}`,
			"Stripe-Version": PUBLISHED.apiVersion,
			...(get ? {} : { "Content-Type": "application/x-www-form-urlencoded" }),
			...(input.idempotencyKey
				? { "Idempotency-Key": input.idempotencyKey }
				: {}),
		},
		...(get ? {} : { body: form }),
	});
	const answer = (await response.json()) as Record<string, unknown> & {
		error?: { type?: string; code?: string };
	};
	if (!response.ok)
		throw new StripeError(
			`Stripe answered ${response.status} ${answer.error?.type ?? ""} ${answer.error?.code ?? ""} for ${input.method} ${input.path}`,
			response.status,
			answer.error?.code ?? null,
		);
	assertTestMode(answer, input.path);
	return answer;
};
