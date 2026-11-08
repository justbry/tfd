import { describe, expect, test } from "bun:test";
import {
	type PublishedPlans,
	publishPlans,
	type StripeCall,
} from "../scripts/publish-plans";
import { PUBLISHED } from "../src/billing/plans";

/** A test-mode Stripe in memory: products searched by metadata, prices listed by lookup key. */
const fakeStripe = (livemode = false) => {
	const products: Record<string, unknown>[] = [];
	const prices: Record<string, unknown>[] = [];
	const writes: string[] = [];
	const call: StripeCall = async (method, path, params) => {
		const field = (name: string) =>
			params.find(([key]) => key === name)?.[1] as string;
		const metadata = Object.fromEntries(
			params
				.filter(([key]) => key.startsWith("metadata["))
				.map(([key, value]) => [key.slice(9, -1), value]),
		);
		if (method === "GET" && path === "/v1/products/search") {
			const query = field("query");
			return {
				data: products.filter((product) =>
					query.includes(
						`'${(product.metadata as Record<string, string>).b4u_key}' AND metadata['b4u_school']:'${(product.metadata as Record<string, string>).b4u_school}'`,
					),
				),
			};
		}
		if (method === "GET" && path === "/v1/prices")
			return {
				data: prices.filter(
					(price) => price.lookup_key === field("lookup_keys[]"),
				),
			};
		writes.push(`${method} ${path}`);
		if (path === "/v1/products") {
			const product = {
				id: `prod_${products.length + 1}`,
				livemode,
				metadata,
			};
			products.push(product);
			return product;
		}
		if (path === "/v1/prices") {
			const price = {
				id: `price_${prices.length + 1}`,
				livemode,
				active: true,
				lookup_key: field("lookup_key"),
				product: field("product"),
				unit_amount: Number(field("unit_amount")),
				recurring: { interval: field("recurring[interval]") },
			};
			prices.push(price);
			return price;
		}
		throw new Error(`unexpected ${method} ${path}`);
	};
	return { call, products, prices, writes };
};

describe("publishing Trifold's menus to Stripe test mode", () => {
	test("the first publish makes two products and four prices per school; a rerun makes nothing and writes the same file", async () => {
		const stripe = fakeStripe();
		const first = await publishPlans({
			stripe: stripe.call,
			previous: null,
			stripeAccount: "acct_test",
		});
		expect(stripe.products.length).toBe(4);
		expect(stripe.prices.length).toBe(8);
		expect(Object.keys(first.schools)).toEqual(["tf-std", "tf-np"]);
		expect(first.schools["tf-std"]?.products).toEqual({
			"t:audited": expect.stringMatching(/^prod_/),
			"t:starter": expect.stringMatching(/^prod_/),
		});
		expect(Object.keys(first.schools["tf-std"]?.priceIds ?? {})).toEqual([
			"b4u_tf-std_t_starter_month_2900_usd",
			"b4u_tf-std_t_starter_year_29000_usd",
			"b4u_tf-std_t_audited_month_14900_usd",
			"b4u_tf-std_t_audited_year_149000_usd",
		]);
		// No Pro (a draft) and no coupon (no member code).
		expect(JSON.stringify(stripe.prices)).not.toContain("_pro_");
		const writes = stripe.writes.length;

		const again = await publishPlans({
			stripe: stripe.call,
			previous: first,
			stripeAccount: "acct_test",
		});
		expect(stripe.writes.length).toBe(writes);
		expect(again).toEqual(first);

		// Lost the file: everything is found again by b4u_key and lookup key, nothing is made twice.
		const lost = await publishPlans({
			stripe: stripe.call,
			previous: null,
			stripeAccount: "acct_test",
		});
		expect(stripe.writes.length).toBe(writes);
		expect(lost).toEqual(first);
	});

	test("a live-mode answer stops the publish", async () => {
		const stripe = fakeStripe(true);
		await expect(
			publishPlans({
				stripe: stripe.call,
				previous: null,
				stripeAccount: "acct_test",
			}),
		).rejects.toThrow("LIVE-mode");
	});

	test("the committed file is a test-mode publish of the current catalog", async () => {
		expect(PUBLISHED.livemode).toBe(false);
		const stripe = fakeStripe();
		const fresh: PublishedPlans = await publishPlans({
			stripe: stripe.call,
			previous: null,
			stripeAccount: PUBLISHED.stripeAccount,
		});
		for (const [schoolId, school] of Object.entries(fresh.schools)) {
			const committed = PUBLISHED.schools[schoolId];
			expect(committed?.menuVersion).toBe(school.menuVersion);
			expect(committed?.menu).toEqual(school.menu);
			expect(committed?.policy).toEqual(school.policy);
			expect(Object.keys(committed?.priceIds ?? {})).toEqual(
				Object.keys(school.priceIds),
			);
		}
	});
});
