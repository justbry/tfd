import { stripeApi } from "./stripe";

/**
 * What Stripe took for the payment an `invoice.paid` is, for tfd's `paymentFee` (packages/atm `WebhookDeps`). No event
 * carries it: the invoice's paid payments (`GET /v1/invoice_payments`) name a payment intent or a charge, the charge
 * names its balance transaction, and that holds the `fee`. Read before the handler runs, because the handler is
 * synchronous. `not_ready` (no paid payment or no balance transaction yet) and `failed` (no key, Stripe down) mean the
 * fee is not known: the caller answers so the event is retried, never books it at 0.
 */
export type FeeLookup =
	| { ok: true; fee: number }
	| { ok: false; reason: "not_ready" | "failed"; message: string };

type InvoicePayment = {
	status?: unknown;
	payment?: { type?: unknown; payment_intent?: unknown; charge?: unknown };
};

type Charge = { id?: unknown; balance_transaction?: unknown };

const notReady = (message: string): FeeLookup => ({
	ok: false,
	reason: "not_ready",
	message,
});

/** The charge's fee from its expanded balance transaction, or null when Stripe has not made the transaction yet. */
const chargeFee = (charge: Charge | null | undefined): number | null => {
	const transaction = charge?.balance_transaction as
		| { fee?: unknown }
		| null
		| undefined;
	const fee = transaction && typeof transaction === "object" && transaction.fee;
	return Number.isInteger(fee) ? (fee as number) : null;
};

/** The fee of one paid invoice payment: its charge's, 0 for a payment recorded outside Stripe, null when not known yet. */
const paymentFee = async (
	payment: InvoicePayment["payment"],
	call: (path: string, expand: string) => Promise<Record<string, unknown>>,
): Promise<number | null> => {
	if (
		payment?.type === "payment_intent" &&
		typeof payment.payment_intent === "string"
	) {
		const intent = await call(
			`/v1/payment_intents/${payment.payment_intent}`,
			"latest_charge.balance_transaction",
		);
		return chargeFee(intent.latest_charge as Charge | null);
	}
	if (payment?.type === "charge" && typeof payment.charge === "string")
		return chargeFee(
			(await call(
				`/v1/charges/${payment.charge}`,
				"balance_transaction",
			)) as Charge,
		);
	// `payment_record`: paid outside Stripe (Stripe took nothing).
	return payment?.type === "payment_record" ? 0 : null;
};

/** The fee of an `invoice.paid` event's payment; null for any other event (no fee to look up). */
export const invoicePaidFee = async (
	event: unknown,
	input: { key: string | undefined; fetcher: typeof fetch },
): Promise<FeeLookup | null> => {
	const { type, data } = (event ?? {}) as {
		type?: unknown;
		data?: { object?: Record<string, unknown> };
	};
	if (type !== "invoice.paid") return null;
	const invoice = data?.object ?? {};
	const invoiceId = invoice.id;
	if (typeof invoiceId !== "string")
		return { ok: false, reason: "failed", message: "the invoice has no id" };
	// Nothing collected (a trial, a 100% discount) or paid outside Stripe: no Stripe fee.
	if (invoice.amount_paid === 0 || invoice.paid_out_of_band === true)
		return { ok: true, fee: 0 };
	const call = (path: string, expand: string) =>
		stripeApi({
			key: input.key,
			fetcher: input.fetcher,
			method: "GET",
			path,
			params: [["expand[]", expand]],
		});
	try {
		const list = await stripeApi({
			key: input.key,
			fetcher: input.fetcher,
			method: "GET",
			path: "/v1/invoice_payments",
			params: [
				["invoice", invoiceId],
				["status", "paid"],
				["limit", "100"],
			],
		});
		const paid = ((list.data ?? []) as InvoicePayment[]).filter(
			(entry) => entry.status === "paid",
		);
		if (paid.length === 0)
			return notReady(`${invoiceId} has no paid payment yet`);
		let total = 0;
		for (const entry of paid) {
			const fee = await paymentFee(entry.payment, call);
			if (fee === null)
				return notReady(
					`${invoiceId}: the balance transaction of its payment is not there yet`,
				);
			total += fee;
		}
		return { ok: true, fee: total };
	} catch (error) {
		return {
			ok: false,
			reason: "failed",
			message: error instanceof Error ? error.message : String(error),
		};
	}
};
