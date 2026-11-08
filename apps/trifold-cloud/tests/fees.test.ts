import { describe, expect, test } from "bun:test";
import { invoicePaidFee } from "../src/billing/fees";
import { fakeStripeApi, feeRoutes } from "./fakes";

const KEY = "rk_test_unit";

const paid = (invoice: Record<string, unknown> = {}) => ({
	id: "evt_fee",
	type: "invoice.paid",
	data: {
		object: { id: "in_fee_1", amount_paid: 2900, livemode: false, ...invoice },
	},
});

describe("the Stripe fee of an invoice.paid", () => {
	test("reads the invoice's paid payment, its charge and the balance transaction's fee, with the test key", async () => {
		const stripe = fakeStripeApi(feeRoutes(114));
		expect(
			await invoicePaidFee(paid(), { key: KEY, fetcher: stripe.fetcher }),
		).toEqual({ ok: true, fee: 114 });
		expect(stripe.calls.map((call) => call.path)).toEqual([
			"/v1/invoice_payments",
			"/v1/payment_intents/pi_fee_1",
		]);
		expect(stripe.calls[0]?.params.get("invoice")).toBe("in_fee_1");
		expect(stripe.calls[1]?.params.get("expand[]")).toBe(
			"latest_charge.balance_transaction",
		);
	});

	test("a payment by charge reads the charge's balance transaction; several payments add up", async () => {
		const stripe = fakeStripeApi(({ url }) => {
			if (url.pathname === "/v1/invoice_payments")
				return {
					body: {
						data: [
							{ status: "paid", payment: { type: "charge", charge: "ch_a" } },
							{ status: "paid", payment: { type: "charge", charge: "ch_b" } },
							{
								status: "canceled",
								payment: { type: "charge", charge: "ch_c" },
							},
						],
					},
				};
			const charge = url.pathname.split("/").at(-1);
			return {
				body: {
					id: charge,
					balance_transaction: { fee: charge === "ch_a" ? 50 : 40 },
				},
			};
		});
		expect(
			await invoicePaidFee(paid(), { key: KEY, fetcher: stripe.fetcher }),
		).toEqual({ ok: true, fee: 90 });
		expect(stripe.calls.map((call) => call.path)).not.toContain(
			"/v1/charges/ch_c",
		);
	});

	test("no balance transaction yet, or no paid payment yet, is not_ready: never a fee of 0", async () => {
		const pending = fakeStripeApi(feeRoutes(null));
		expect(
			await invoicePaidFee(paid(), { key: KEY, fetcher: pending.fetcher }),
		).toMatchObject({ ok: false, reason: "not_ready" });
		const none = fakeStripeApi(({ url }) =>
			url.pathname === "/v1/invoice_payments" ? { body: { data: [] } } : null,
		);
		expect(
			await invoicePaidFee(paid(), { key: KEY, fetcher: none.fetcher }),
		).toMatchObject({ ok: false, reason: "not_ready" });
	});

	test("nothing collected or paid out of band is a fee of 0 with no Stripe call", async () => {
		const stripe = fakeStripeApi();
		for (const invoice of [{ amount_paid: 0 }, { paid_out_of_band: true }])
			expect(
				await invoicePaidFee(paid(invoice), {
					key: KEY,
					fetcher: stripe.fetcher,
				}),
			).toEqual({ ok: true, fee: 0 });
		expect(stripe.calls).toEqual([]);
	});

	test("other events need no fee", async () => {
		const stripe = fakeStripeApi();
		expect(
			await invoicePaidFee(
				{ type: "customer.subscription.created", data: { object: {} } },
				{ key: KEY, fetcher: stripe.fetcher },
			),
		).toBeNull();
	});

	test("no key, a live key, a Stripe error or a live-mode answer is failed, with no secret in the message", async () => {
		const stripe = fakeStripeApi(feeRoutes(114));
		for (const key of [undefined, "sk_live_nope", "rk_live_nope"]) {
			const lookup = await invoicePaidFee(paid(), {
				key,
				fetcher: stripe.fetcher,
			});
			expect(lookup).toMatchObject({ ok: false, reason: "failed" });
			expect(JSON.stringify(lookup)).not.toContain("_live_");
		}
		expect(stripe.calls).toEqual([]);
		const down = fakeStripeApi(() => ({
			status: 500,
			body: { error: { type: "api_error" } },
		}));
		expect(
			await invoicePaidFee(paid(), { key: KEY, fetcher: down.fetcher }),
		).toMatchObject({ ok: false, reason: "failed" });
		const live = fakeStripeApi(({ url }) =>
			url.pathname === "/v1/invoice_payments"
				? { body: { data: [{ status: "paid", livemode: true }] } }
				: null,
		);
		expect(
			await invoicePaidFee(paid(), { key: KEY, fetcher: live.fetcher }),
		).toMatchObject({ ok: false, reason: "failed" });
	});
});
