/**
 * Publishes Trifold's two menus (`catalog/trifold`) to Stripe TEST mode with tfd's `menuToStripe`, then writes
 * `src/published-plans.json`: per school id, the validated menu, the resolved policy, a menu version and the Stripe
 * product and price ids. The Worker bundles that file, so checkout and the webhook handler read the ids without a
 * Stripe or D1 round trip, a deploy carries a publish, and git shows what was published. Nothing in it is secret.
 *
 *   bun scripts/publish-plans.ts            publish (test mode), write the file
 *   bun scripts/publish-plans.ts --dry-run  print the steps, call nothing
 *
 * Runs Stripe through the Stripe CLI's logged-in session (`stripe get|post`, test mode by default; `--live` is never
 * passed) so no key is read or printed here. Every object Stripe returns must say `livemode: false`, or the run stops.
 * Idempotent: the previous publish is `previous` for `menuToStripe` (a rerun makes no step), products and prices are
 * found again by `b4u_key` and lookup key before any create, and every create carries tfd's idempotency key.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
	checkTrifoldCatalog,
	trifoldLookupKey,
} from "../../../catalog/trifold/check.ts";
import {
	TRIFOLD_ORGS,
	TRIFOLD_SCHOOL_IDS,
	type TrifoldOrg,
} from "../../../catalog/trifold/index.ts";
import { menuToStripe } from "../../../packages/atm/src/billing/stripe-menu.ts";
import type {
	BillingPolicy,
	Menu,
	StripeOp,
} from "../../../packages/atm/src/types.ts";

/** The API version tfd's handler reads (its recorded payloads). */
export const STRIPE_API_VERSION = "2025-10-29.clover";

export type StripeCall = (
	method: "GET" | "POST",
	path: string,
	params: readonly (readonly [string, string])[],
	idempotencyKey?: string,
) => Promise<Record<string, unknown>>;

export type PublishedSchool = {
	org: TrifoldOrg;
	/** sha256 of the menu and policy, first 12 hex: the `menu_version` on each checkout. */
	menuVersion: string;
	menu: Menu;
	policy: BillingPolicy;
	/** Stripe product ids by the menu's key (`t:<tierId>`). */
	products: Record<string, string>;
	/** Stripe price ids by lookup key: what checkout and the handler's `priceIds` take. */
	priceIds: Record<string, string>;
};

export type PublishedPlans = {
	stripeAccount: string;
	livemode: false;
	apiVersion: string;
	schools: Record<string, PublishedSchool>;
};

const OUTPUT = join(import.meta.dir, "../src/published-plans.json");

const canonical = (value: unknown): string =>
	JSON.stringify(value, (_key, inner) =>
		inner && typeof inner === "object" && !Array.isArray(inner)
			? Object.fromEntries(
					Object.entries(inner).sort(([a], [b]) => a.localeCompare(b)),
				)
			: inner,
	);

export const menuVersionOf = (menu: Menu, policy: BillingPolicy): string =>
	createHash("sha256")
		.update(canonical({ menu, policy }))
		.digest("hex")
		.slice(0, 12);

/** Refuses any Stripe object that is not test mode, at any depth. */
const assertTestMode = (value: unknown, path: string): void => {
	if (!value || typeof value !== "object") return;
	if ((value as { livemode?: unknown }).livemode === true)
		throw new Error(`Stripe answered a LIVE-mode object for ${path}; stopping`);
	for (const inner of Object.values(value)) assertTestMode(inner, path);
};

const listData = (answer: Record<string, unknown>) =>
	(answer.data ?? []) as Record<string, unknown>[];

const quote = (text: string) => text.replaceAll("'", "\\'");

/** A product `menuToStripe` made, found again by its `b4u_key` and school (Stripe's search lags creates by about a minute). */
const searchProduct = async (
	stripe: StripeCall,
	schoolId: string,
	key: string,
): Promise<string | null> => {
	const answer = await stripe("GET", "/v1/products/search", [
		[
			"query",
			`metadata['b4u_key']:'${quote(key)}' AND metadata['b4u_school']:'${quote(schoolId)}'`,
		],
	]);
	const id = listData(answer)[0]?.id;
	return typeof id === "string" ? id : null;
};

/** Runs `menuToStripe`'s steps for one school; returns its product ids by key. */
const runOps = async (
	stripe: StripeCall,
	schoolId: string,
	ops: readonly StripeOp[],
	known: Record<string, string>,
): Promise<Record<string, string>> => {
	const products = { ...known };
	const findProduct = async (key: string): Promise<string | null> =>
		products[key] ?? (await searchProduct(stripe, schoolId, key));
	const findPrice = async (lookupKey: string): Promise<string | null> => {
		const answer = await stripe("GET", "/v1/prices", [
			["lookup_keys[]", lookupKey],
		]);
		const id = listData(answer)[0]?.id;
		return typeof id === "string" ? id : null;
	};
	for (const op of ops) {
		switch (op.op) {
			case "product.create": {
				const found = await findProduct(op.key);
				if (found) {
					products[op.key] = found;
					break;
				}
				const created = await stripe(
					"POST",
					"/v1/products",
					[
						["name", op.name],
						...(op.description
							? [["description", op.description] as const]
							: []),
						...Object.entries(op.metadata).map(
							([name, value]) => [`metadata[${name}]`, value] as const,
						),
					],
					op.idempotencyKey,
				);
				products[op.key] = created.id as string;
				break;
			}
			case "product.update": {
				const id = await findProduct(op.key);
				if (!id) throw new Error(`no Stripe product for ${op.key}`);
				await stripe(
					"POST",
					`/v1/products/${id}`,
					[
						["name", op.name],
						...(op.description
							? [["description", op.description] as const]
							: []),
						["active", String(op.active)],
					],
					op.idempotencyKey,
				);
				products[op.key] = id;
				break;
			}
			case "price.create": {
				if (await findPrice(op.lookupKey)) break;
				const product = await findProduct(op.productKey);
				if (!product) throw new Error(`no Stripe product for ${op.productKey}`);
				await stripe(
					"POST",
					"/v1/prices",
					[
						["product", product],
						["currency", op.currency],
						["unit_amount", String(op.unitAmount)],
						["lookup_key", op.lookupKey],
						...(op.recurring
							? [["recurring[interval]", op.recurring.interval] as const]
							: []),
						...Object.entries(op.metadata).map(
							([name, value]) => [`metadata[${name}]`, value] as const,
						),
					],
					op.idempotencyKey,
				);
				break;
			}
			case "price.archive": {
				const id = await findPrice(op.lookupKey);
				if (id)
					await stripe(
						"POST",
						`/v1/prices/${id}`,
						[["active", "false"]],
						op.idempotencyKey,
					);
				break;
			}
			default:
				// Trifold's policy has no member code and its menus no codes: a coupon step means the catalog changed.
				throw new Error(`publish-plans does not run ${op.op} steps`);
		}
	}
	return products;
};

export const publishPlans = async (input: {
	stripe: StripeCall;
	previous: PublishedPlans | null;
	stripeAccount: string;
	dryRun?: boolean;
	log?: (line: string) => void;
}): Promise<PublishedPlans> => {
	const log = input.log ?? (() => {});
	const { menus, policy } = checkTrifoldCatalog();
	const stripe: StripeCall = async (method, path, params, key) => {
		const answer = await input.stripe(method, path, params, key);
		assertTestMode(answer, path);
		return answer;
	};
	const schools: Record<string, PublishedSchool> = {};
	for (const org of TRIFOLD_ORGS) {
		const schoolId = TRIFOLD_SCHOOL_IDS[org];
		const menu = menus[org];
		const before = input.previous?.schools[schoolId] ?? null;
		const ops = menuToStripe({
			schoolId,
			menu,
			previous: before?.menu ?? null,
			policy,
			previousPolicy: before?.policy ?? null,
		});
		log(
			`${schoolId}: ${ops.length} step(s)${ops.map((op) => `\n  ${op.op} ${"lookupKey" in op ? op.lookupKey : "key" in op ? op.key : ""}`).join("")}`,
		);
		if (input.dryRun) continue;
		const products = await runOps(
			stripe,
			schoolId,
			ops,
			before?.products ?? {},
		);
		const priceIds: Record<string, string> = {};
		const sold = menu.tiers.filter((tier) => tier.public);
		for (const lookupKey of sold.flatMap((tier) =>
			tier.prices.map((price) =>
				trifoldLookupKey(org, tier.id, price.interval),
			),
		)) {
			const answer = await stripe("GET", "/v1/prices", [
				["lookup_keys[]", lookupKey],
			]);
			const [price] = listData(answer);
			if (typeof price?.id !== "string" || price.active !== true)
				throw new Error(
					`${lookupKey} is not an active Stripe price after publishing`,
				);
			priceIds[lookupKey] = price.id;
		}
		for (const tier of sold) {
			const key = `t:${tier.id}`;
			products[key] ??= (await searchProduct(stripe, schoolId, key)) ?? "";
			if (!products[key])
				throw new Error(`no Stripe product id for ${schoolId} ${key}`);
		}
		schools[schoolId] = {
			org,
			menuVersion: menuVersionOf(menu, policy),
			menu,
			policy,
			products: Object.fromEntries(
				Object.entries(products).sort(([a], [b]) => a.localeCompare(b)),
			),
			priceIds,
		};
	}
	return {
		stripeAccount: input.stripeAccount,
		livemode: false,
		apiVersion: STRIPE_API_VERSION,
		schools,
	};
};

/** `stripe get|post` through the CLI's logged-in TEST session. */
export const stripeCli: StripeCall = async (method, path, params, key) => {
	const args = [
		"stripe",
		method === "GET" ? "get" : "post",
		path,
		"--stripe-version",
		STRIPE_API_VERSION,
		...params.flatMap(([name, value]) => ["-d", `${name}=${value}`]),
		...(key ? ["--idempotency", key] : []),
	];
	const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
	const [out, code] = await Promise.all([
		new Response(child.stdout).text(),
		child.exited,
	]);
	const answer = JSON.parse(out || "{}") as Record<string, unknown>;
	if (code !== 0 || answer.error)
		throw new Error(
			`stripe ${method} ${path} failed: ${JSON.stringify((answer.error as { message?: string })?.message ?? code)}`,
		);
	return answer;
};

if (import.meta.main) {
	const dryRun = process.argv.includes("--dry-run");
	const file = Bun.file(OUTPUT);
	const previous = (await file.exists())
		? ((await file.json()) as PublishedPlans)
		: null;
	const account = await stripeCli("GET", "/v1/account", []);
	const stripeAccount = String(account.id);
	if (previous && previous.stripeAccount !== stripeAccount)
		throw new Error(
			`the CLI is logged in to ${stripeAccount}, and ${OUTPUT} was published to ${previous.stripeAccount}`,
		);
	const published = await publishPlans({
		stripe: stripeCli,
		previous,
		stripeAccount,
		dryRun,
		log: console.log,
	});
	if (!dryRun) {
		await Bun.write(OUTPUT, `${JSON.stringify(published, null, "\t")}\n`);
		console.log(`wrote ${OUTPUT}`);
	}
}
