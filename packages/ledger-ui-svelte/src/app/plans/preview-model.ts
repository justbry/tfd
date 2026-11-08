import type { Menu, MenuGrant } from "$contract/data/plans.ts";
import {
	monthlyAmount,
	type PlanKind,
	priceText,
	yearlyAmount,
} from "./plans-menu.ts";

export type PreviewSource = "live" | "draft";

/** What one card shows of a plan, before the size picked multiplies it. */
export type CardModel = {
	kind: PlanKind;
	id: string;
	name: string;
	blurb: string;
	hidden: boolean;
	/** One unit's price now, undefined when the plan has none for the period; and in the live version (undefined when
	 * the plan is not live). */
	amount: number | undefined;
	publishedAmount: number | undefined;
	/** "month", "year" or "" for a pack charged once. */
	period: string;
	quantities: number[] | undefined;
	grants: MenuGrant[];
	once: boolean;
	inLive: boolean;
	/** What a plan with no price says in its place (`priceText`: "Not for sale"). */
	unpriced?: string;
};

const percentBase = 100;
/** A price after `percent` off, rounded to whole cents as the mockup's `money` rounds it. */
export const discounted = (cents: number, percent: number): number =>
	Math.round((cents * (percentBase - percent)) / percentBase);

export const chooseToast =
	"Preview only. Members would continue to Stripe Checkout.";
export const liveEmpty =
	"Nothing is published yet. Switch to Draft to see what you've set up, or add a plan in Edit.";
export const draftEmpty = "No plans yet. Switch to Edit to add a membership.";

/** The cards of the purchase page: memberships then packs, from the live menu or the draft. */
export function cardModels(
	live: Menu,
	menu: Menu,
	showingLive: boolean,
	yearly: boolean,
): { tiers: CardModel[]; addons: CardModel[] } {
	const tiers = menu.tiers
		.filter((tier) => !showingLive || tier.public)
		.map((tier): CardModel => {
			const yearlyPrice = yearly && yearlyAmount(tier) !== undefined;
			const before = live.tiers.find(({ id }) => id === tier.id);
			const pick = yearlyPrice ? yearlyAmount : monthlyAmount;
			return {
				kind: "tiers",
				id: tier.id,
				name: tier.name,
				blurb: tier.blurb,
				hidden: !tier.public && !showingLive,
				amount: pick(tier),
				publishedAmount: before ? pick(before) : undefined,
				period: yearlyPrice ? "year" : "month",
				quantities: tier.quantities,
				grants: tier.grants,
				once: false,
				inLive: before !== undefined,
				unpriced: priceText(menu, tier),
			};
		});
	const addons = menu.addons.map((addon): CardModel => {
		const before = live.addons.find(({ id }) => id === addon.id);
		return {
			kind: "addons",
			id: addon.id,
			name: addon.name,
			blurb: "",
			hidden: false,
			amount: addon.price.amount,
			publishedAmount: before?.price.amount,
			period: addon.price.every === "once" ? "" : addon.price.every,
			quantities: undefined,
			grants: addon.grants,
			once: addon.price.every === "once",
			inLive: before !== undefined,
		};
	});
	return { tiers, addons };
}
