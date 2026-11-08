import type { Menu } from "$contract/data/plans.ts";
import type { PlansDraftConfig } from "$worker-config/types.ts";

/** The `plans-draft` copy of a school with nothing stored yet: the draft menu's names, descriptions, order, on-sale flags
 * and audiences, never its prices (S9-plan section 3.1). */
export const seedFromMenu = (
	menu: Menu,
	options: { draftVersion: number | null; purchaseLinkShared: boolean },
): PlansDraftConfig => ({
	schemaVersion: 1,
	draftVersion: options.draftVersion,
	features: menu.features.map(({ id, name, unit }) => ({
		id,
		name,
		unit: { one: unit.one, other: unit.other },
	})),
	tierOrder: menu.tiers.map(({ id }) => id),
	tiers: menu.tiers.map(({ id, name, blurb, public: onSale, audience }) => ({
		id,
		name,
		blurb,
		public: onSale,
		...(audience === undefined ? {} : { audience }),
	})),
	purchaseLinkShared: options.purchaseLinkShared,
});
