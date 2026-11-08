/**
 * The Trifold catalog checked with tfd itself (Node or Bun only: it imports the engine's validators, Ajv and
 * node:crypto, so a browser bundle must not import it). Run as a script (`bun catalog/trifold/check.ts`, a step of the
 * site's build) it exits 1 when tfd refuses the catalog; checkout reads the lookup keys from `trifoldLookupKey`.
 */

import {
	publishProblems,
	validateMenu,
} from "../../packages/atm/src/billing/menu.ts";
import { resolvePolicy } from "../../packages/atm/src/billing/policy.ts";
import {
	lookupKeyOf,
	tierPriceKey,
} from "../../packages/atm/src/billing/stripe-menu.ts";
import type {
	BillingPolicy,
	Interval,
	Menu,
} from "../../packages/atm/src/types.ts";
import {
	TRIFOLD_FREE,
	TRIFOLD_MENUS,
	TRIFOLD_ORGS,
	TRIFOLD_POLICY,
	TRIFOLD_SCHOOL_IDS,
	type TrifoldOrg,
} from "./index.ts";

/** The smallest price tfd sells: Free's allowance is checked as a draft tier at this price. */
const PROBE_AMOUNT = 50;

/**
 * Validates both menus with `validateMenu` and `publishProblems`, the policy with `resolvePolicy`, and Free's grants as
 * a draft tier of the standard menu. Throws one Error naming every problem; returns the menus and policy tfd accepted.
 */
export function checkTrifoldCatalog(): {
	menus: Record<TrifoldOrg, Menu>;
	policy: BillingPolicy;
} {
	const problems: string[] = [];
	const menus = {} as Record<TrifoldOrg, Menu>;
	for (const org of TRIFOLD_ORGS) {
		const result = validateMenu(TRIFOLD_MENUS[org]);
		if (!result.ok) {
			problems.push(
				`${org} menu: ${[...result.problems, ...(result.messages ?? [])].join("; ")}`,
			);
			continue;
		}
		menus[org] = result.menu;
		for (const path of publishProblems(result.menu))
			problems.push(`${org} menu cannot be published: ${path}`);
	}
	const standard = TRIFOLD_MENUS.std;
	const withFree = validateMenu({
		...standard,
		tiers: [
			...standard.tiers.filter((tier) => tier.id !== TRIFOLD_FREE.id),
			{
				id: TRIFOLD_FREE.id,
				name: TRIFOLD_FREE.name,
				blurb: "",
				public: false,
				prices: [{ interval: "month", amount: PROBE_AMOUNT }],
				grants: TRIFOLD_FREE.grants,
			},
		],
	});
	if (!withFree.ok)
		problems.push(
			`free plan: ${[...withFree.problems, ...(withFree.messages ?? [])].join("; ")}`,
		);
	let policy: BillingPolicy | null = null;
	try {
		policy = resolvePolicy(TRIFOLD_POLICY);
	} catch (error) {
		problems.push(String(error));
	}
	if (problems.length > 0 || !policy)
		throw new Error(
			`The Trifold catalog fails tfd's checks:\n${problems.join("\n")}`,
		);
	return { menus, policy };
}

/** The Stripe lookup key of a paid plan's price, as tfd's `menuToStripe` publishes it. */
export function trifoldLookupKey(
	org: TrifoldOrg,
	tierId: string,
	interval: Interval,
): string {
	const menu = TRIFOLD_MENUS[org];
	const price = menu.tiers
		.find((tier) => tier.id === tierId)
		?.prices.find((entry) => entry.interval === interval);
	if (!price)
		throw new Error(
			`Trifold catalog: the ${org} menu has no ${interval} price for ${tierId}`,
		);
	return lookupKeyOf(
		TRIFOLD_SCHOOL_IDS[org],
		tierPriceKey(tierId, interval),
		price.amount,
		menu.currency,
	);
}

if (import.meta.main) {
	checkTrifoldCatalog();
	console.log(
		"catalog/trifold: both menus, the policy and Free pass tfd's checks.",
	);
}
