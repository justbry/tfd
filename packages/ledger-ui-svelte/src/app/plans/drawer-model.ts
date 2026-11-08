import {
	type Menu,
	type MenuAddon,
	type MenuAudience,
	type MenuGrant,
	type MenuInterval,
	type MenuTier,
} from "$contract/data/plans.ts";
import type { DisclosureGrain } from "$contract/data/disclosure.ts";
import {
	audienceName,
	monthlyAmount,
	type PlanKind,
	tierAudience,
	yearlyAmount,
} from "./plans-menu.ts";

/** Mockup `GR_PL`: a grain as the plural the hint writes. */
export const grainPlural: Record<DisclosureGrain, string> = {
	year: "years",
	quarter: "quarters",
	month: "months",
	day: "days",
};
export const audienceHint = (memberGrain: string): string =>
	`What members of this plan see of the school's books. Member: ${memberGrain}, money rounded, totals and categories. Governance: months, exact, with plan and fund breakdowns and how gifts spread, but no names. Public: nothing beyond what anyone sees. A governance plan is usually hidden (not for sale) and given by the owner. Finance and Owner are never a tier's audience. Access moves at once for current members, with a notice.`;
const centsPerUnit = 100;
export const defaultGrantAmount = 8;
export const audienceChoices: Array<[MenuAudience, string]> = [
	["member", `${audienceName.member} (default)`],
	["governance", audienceName.governance],
	["public", audienceName.public],
];
export const intervalChoices = ["month", "year"] as const;
export const intervalLabels: Record<MenuInterval, string> = {
	month: "Each month",
	year: "Each year",
};
export const charges = ["once", "month", "year"] as const;
export type Charge = (typeof charges)[number];
export const chargeLabels: Record<Charge, string> = {
	once: "One time",
	month: "Monthly",
	year: "Yearly",
};
export const audienceChoice = (value: string): MenuAudience =>
	audienceChoices.find(([choice]) => choice === value)?.[0] ?? "member";
export const chargeChoice = (value: string): Charge =>
	charges.find((choice) => choice === value) ?? "once";

/** What the fields hold as typed: amounts in major units, sizes as "1, 2, 4". */
export type GrantForm = {
	featureId: string;
	amount: string;
	every: MenuInterval;
	rollover: string;
	/** Stored, not offered: kept as it was. */
	max: number | undefined;
};
export type PlanForm = {
	name: string;
	blurb: string;
	isPublic: boolean;
	audience: MenuAudience;
	month: string;
	year: string;
	quantities: string;
	price: string;
	charge: Charge;
	grants: GrantForm[];
};

const majorText = (cents: number | undefined): string =>
	cents ? String(cents / centsPerUnit) : "";
export const grantForm = (grant: MenuGrant): GrantForm => ({
	featureId: grant.featureId,
	amount: String(grant.amount),
	every: grant.every,
	rollover: String(grant.rollover?.months ?? 0),
	max: grant.rollover?.max,
});
export const newGrant = (menu: Menu): GrantForm =>
	grantForm({
		featureId: menu.features[0]?.id ?? "",
		amount: defaultGrantAmount,
		every: "month",
	});

export function formOf(
	item: MenuTier | MenuAddon | null,
	kind: PlanKind,
	menu: Menu,
): PlanForm {
	const blank: PlanForm = {
		name: "",
		blurb: "",
		isPublic: true,
		audience: "member",
		month: "",
		year: "",
		quantities: "",
		price: "",
		charge: "once",
		grants: [newGrant(menu)],
	};
	if (kind === "tiers" && item && "prices" in item)
		return {
			...blank,
			name: item.name,
			blurb: item.blurb,
			isPublic: item.public,
			audience: tierAudience(item),
			month: majorText(monthlyAmount(item)),
			year: majorText(yearlyAmount(item)),
			quantities: item.quantities?.join(", ") ?? "",
			grants: item.grants.map(grantForm),
		};
	if (item && "price" in item)
		return {
			...blank,
			name: item.name,
			price: majorText(item.price.amount),
			charge: item.price.every,
			grants: item.grants.map(grantForm),
		};
	return blank;
}

const wholeNumber = (text: string): number => Number.parseInt(text, 10) || 0;
const cents = (text: string): number =>
	Math.round((Number.parseFloat(text) || 0) * centsPerUnit);
/** Mockup `readPE`: sizes that are not numbers become 0, which the problems then name. */
export function sizesOf(text: string): number[] | undefined {
	const trimmed = text.trim();
	if (!trimmed) return undefined;
	const sizes = trimmed
		.split(",")
		.map((size) => Number.parseInt(size.trim(), 10));
	return sizes.some(Number.isNaN) ? [0] : sizes;
}

function grantsOf(form: PlanForm): MenuGrant[] {
	return form.grants.map((grant) => {
		const months = wholeNumber(grant.rollover);
		return {
			featureId: grant.featureId,
			amount: wholeNumber(grant.amount),
			every: grant.every,
			...(months > 0
				? {
						rollover: {
							months,
							...(grant.max === undefined ? {} : { max: grant.max }),
						},
					}
				: {}),
		};
	});
}

export function tierOf(form: PlanForm, id: string): MenuTier {
	const month = cents(form.month);
	const year = cents(form.year);
	const sizes = sizesOf(form.quantities);
	return {
		id,
		name: form.name,
		blurb: form.blurb,
		public: form.isPublic,
		prices: [
			...(month === 0 ? [] : [{ interval: "month" as const, amount: month }]),
			...(year > 0 ? [{ interval: "year" as const, amount: year }] : []),
		],
		grants: grantsOf(form),
		...(sizes ? { quantities: sizes } : {}),
		...(form.audience === "member" ? {} : { audience: form.audience }),
	};
}

export const addonOf = (form: PlanForm, id: string): MenuAddon => ({
	id,
	name: form.name,
	price: { amount: cents(form.price), every: form.charge },
	grants: grantsOf(form),
});
