import {
	type BillingPolicy,
	type Interval,
	type Menu,
	menuCatalogRows,
	type WebhookContext,
} from "../../../../packages/atm/src/cloud.ts";
import published from "../published-plans.json" with { type: "json" };

/** `std`: the standard price; `np`: verified non-profits and co-ops (`catalog/trifold`). */
export type Org = "std" | "np";

export type PublishedSchool = {
	org: Org;
	menuVersion: string;
	menu: Menu;
	policy: BillingPolicy;
	products: Record<string, string>;
	priceIds: Record<string, string>;
	/** The billing portal configuration (`bpc_…`) its customers' portal sessions use. */
	portalConfiguration: string;
};

/** What `scripts/publish-plans.ts` wrote: Trifold's menus as published to Stripe test mode, by school id. */
export const PUBLISHED = published as unknown as {
	stripeAccount: string;
	livemode: false;
	apiVersion: string;
	schools: Record<string, PublishedSchool>;
};

/** The school id of each org's menu (`TRIFOLD_SCHOOL_IDS`). */
export const SCHOOL_OF: Record<Org, string> = { std: "tf-std", np: "tf-np" };
export const SCHOOL_IDS: readonly string[] = Object.values(SCHOOL_OF);

export const publishedSchool = (schoolId: string): PublishedSchool | null =>
	PUBLISHED.schools[schoolId] ?? null;

/** A tier checkout sells: public in the menu, with a published price for the interval. */
export const soldTier = (org: Org, tierId: string, interval: Interval) => {
	const school = publishedSchool(SCHOOL_OF[org]);
	const tier = school?.menu.tiers.find((entry) => entry.id === tierId);
	if (!school || !tier) return { ok: false as const, reason: "unknown_tier" };
	if (!tier.public) return { ok: false as const, reason: "tier_not_sold" };
	if (!tier.prices.some((price) => price.interval === interval))
		return { ok: false as const, reason: "unknown_interval" };
	return { ok: true as const, school, tier };
};

const contexts = new Map<string, WebhookContext>();

/** The handler's context for a Trifold school (test mode): its menu, policy, catalog rows and Stripe price ids. */
export const webhookContext = (schoolId: string): WebhookContext | null => {
	const school = publishedSchool(schoolId);
	if (!school) return null;
	let context = contexts.get(schoolId);
	if (!context) {
		context = {
			menu: school.menu,
			menuVersion: school.menuVersion,
			policy: school.policy,
			policyVersion: school.menuVersion,
			catalog: menuCatalogRows({
				menu: school.menu,
				school: schoolId,
				env: "test",
			}),
			priceIds: school.priceIds,
		};
		contexts.set(schoolId, context);
	}
	return context;
};
