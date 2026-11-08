/**
 * Trifold's own plans, as a tfd catalog: `menu.json` (standard prices) and `menu-nonprofit.json` (verified non-profits
 * and co-ops) are tfd menus (`packages/atm/schema/catalog/menu.v1.json`), `policy.json` is their billing policy, and
 * `free.json` is the Free plan's monthly allowance. Free is not a menu tier: tfd sells a tier through Stripe and needs
 * a price of at least $0.50, and Free is never sold.
 *
 * This module only reads the JSON, so a browser bundle can import it without pulling in the engine, and it declares the
 * part of tfd's `Menu` type it reads rather than importing it, so a project that type-checks this file does not
 * type-check the engine. `check.ts` holds what needs tfd itself: validation (which also proves these files are tfd
 * menus) and the Stripe lookup keys.
 */
import freeJson from "./free.json" with { type: "json" };
import standardJson from "./menu.json" with { type: "json" };
import nonprofitJson from "./menu-nonprofit.json" with { type: "json" };
import policyJson from "./policy.json" with { type: "json" };

type Interval = "month" | "year";
/** tfd's `CatalogGrant`. */
export type CatalogGrant = {
	featureId: string;
	amount: number;
	every: Interval;
	rollover?: { max?: number; months: number };
};
/** The part of tfd's `CatalogTier` read here. */
export type CatalogTier = {
	id: string;
	name: string;
	blurb: string;
	public: boolean;
	prices: { interval: Interval; amount: number }[];
	grants: CatalogGrant[];
};
/** The part of tfd's `Menu` read here; `check.ts` validates the whole file with tfd. */
export type CatalogMenu = {
	currency: string;
	timeZone: string;
	features: {
		id: string;
		name: string;
		unit: { one: string; other: string };
	}[];
	tiers: CatalogTier[];
	addons: unknown[];
};

/** `std`: the standard price; `np`: the price for verified 501(c) organizations and cooperatives. */
export type TrifoldOrg = "std" | "np";
export const TRIFOLD_ORGS: readonly TrifoldOrg[] = ["std", "np"];

export const TRIFOLD_MENUS: Record<TrifoldOrg, CatalogMenu> = {
	std: standardJson as CatalogMenu,
	np: nonprofitJson as CatalogMenu,
};
/** Overrides of tfd's DEFAULT_POLICY (`resolvePolicy` reads them). */
export const TRIFOLD_POLICY: Record<string, unknown> = policyJson;
export const TRIFOLD_FREE: {
	id: string;
	name: string;
	grants: CatalogGrant[];
} = freeJson as { id: string; name: string; grants: CatalogGrant[] };

/**
 * The school id each menu is published under. tfd's lookup keys carry its first eight characters and its products are
 * found again by it, so the two menus need ids that differ there: one Stripe account holds both.
 */
export const TRIFOLD_SCHOOL_IDS: Record<TrifoldOrg, string> = {
	std: "tf-std",
	np: "tf-np",
};

/** The feature ids the plans grant. Event limits are soft: the hosted product suggests an upgrade, it never blocks. */
export const EVENTS_FEATURE = "events";
export const CREDITS_FEATURE = "credits";

export type TrifoldPlan = {
	id: string;
	name: string;
	/** Sold through Stripe checkout: a public tier of the menu. Free and draft tiers are not. */
	sold: boolean;
	/** Whole-dollar (or cents-precise) price a month, per org. Free is 0. */
	monthly: Record<TrifoldOrg, number>;
	/** The yearly price in dollars, per org. Free is 0. */
	yearly: Record<TrifoldOrg, number>;
	/** Ledger events a month. */
	events: number;
	/** Credits a month. */
	credits: number;
};

const monthlyAmount = (grants: readonly CatalogGrant[], featureId: string) => {
	const grant = grants.find((entry) => entry.featureId === featureId);
	if (!grant || grant.every !== "month")
		throw new Error(
			`Trifold catalog: no monthly grant of ${featureId} in ${JSON.stringify(grants)}`,
		);
	return grant.amount;
};

const dollarsOf = (tier: CatalogTier, interval: Interval): number => {
	const price = tier.prices.find((entry) => entry.interval === interval);
	if (!price)
		throw new Error(
			`Trifold catalog: tier ${tier.id} has no ${interval} price`,
		);
	return price.amount / 100;
};

function tierOf(org: TrifoldOrg, id: string): CatalogTier {
	const tier = TRIFOLD_MENUS[org].tiers.find((entry) => entry.id === id);
	if (!tier)
		throw new Error(
			`Trifold catalog: tier ${id} is missing from the ${org} menu`,
		);
	return tier;
}

function paidPlan(standard: CatalogTier): TrifoldPlan {
	const nonprofit = tierOf("np", standard.id);
	if (
		nonprofit.name !== standard.name ||
		nonprofit.public !== standard.public ||
		JSON.stringify(nonprofit.grants) !== JSON.stringify(standard.grants)
	)
		throw new Error(
			`Trifold catalog: tier ${standard.id} differs between the menus in more than its prices`,
		);
	return {
		id: standard.id,
		name: standard.name,
		sold: standard.public,
		monthly: {
			std: dollarsOf(standard, "month"),
			np: dollarsOf(nonprofit, "month"),
		},
		yearly: {
			std: dollarsOf(standard, "year"),
			np: dollarsOf(nonprofit, "year"),
		},
		events: monthlyAmount(standard.grants, EVENTS_FEATURE),
		credits: monthlyAmount(standard.grants, CREDITS_FEATURE),
	};
}

if (
	TRIFOLD_MENUS.np.tiers.map((tier) => tier.id).join() !==
	TRIFOLD_MENUS.std.tiers.map((tier) => tier.id).join()
)
	throw new Error("Trifold catalog: the two menus list different tiers");

/** Every plan, Free first, then the menu's tiers in menu order. */
export const TRIFOLD_PLANS: readonly TrifoldPlan[] = [
	{
		id: TRIFOLD_FREE.id,
		name: TRIFOLD_FREE.name,
		sold: false,
		monthly: { std: 0, np: 0 },
		yearly: { std: 0, np: 0 },
		events: monthlyAmount(TRIFOLD_FREE.grants, EVENTS_FEATURE),
		credits: monthlyAmount(TRIFOLD_FREE.grants, CREDITS_FEATURE),
	},
	...TRIFOLD_MENUS.std.tiers.map(paidPlan),
];

/** One plan by id; throws for an id the catalog does not have. */
export function trifoldPlan(id: string): TrifoldPlan {
	const plan = TRIFOLD_PLANS.find((entry) => entry.id === id);
	if (!plan) throw new Error(`Trifold catalog: no plan ${id}`);
	return plan;
}

/** How many monthly prices a yearly price charges: the same for every paid plan and org, or the catalog throws. */
export const TRIFOLD_ANNUAL_MONTHS: number = (() => {
	const ratios = new Set(
		TRIFOLD_PLANS.filter((plan) => plan.monthly.std > 0).flatMap((plan) =>
			TRIFOLD_ORGS.map((org) => plan.yearly[org] / plan.monthly[org]),
		),
	);
	const [ratio, ...others] = [...ratios];
	if (ratio === undefined || others.length > 0)
		throw new Error(
			`Trifold catalog: yearly prices charge different numbers of months (${[...ratios].join(", ")})`,
		);
	return ratio;
})();
