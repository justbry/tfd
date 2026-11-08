import type { CreditUnit, Promo, PromoType } from "$contract/data/ledger.ts";
import { formatMoney } from "../money.ts";

export const previewTitle = "Exit preview to act";
export const copyFailedToast =
	"Could not copy the code: the browser blocked the clipboard.";
export const minimumNoteLength = 3;
export const defaultValue = "10";
/** cell-rules `minContributors` for redemptions: under this many redeemers a count shows as <10. */
export const smallCount = 5;

export const capitalise = (word: string): string =>
	`${word.slice(0, 1).toUpperCase()}${word.slice(1)}`;

export const countOf = (count: number, unit: CreditUnit): string =>
	`${count} ${count === 1 ? unit.one : unit.other}`;

export const typeLabel = (type: PromoType, unit: CreditUnit): string =>
	({
		member: "Member % off",
		dollar: "Dollar gift",
		session: `${capitalise(unit.one)} gift`,
	})[type];

export const valueText = (
	promo: Promo,
	currency: string,
	unit: CreditUnit,
): string =>
	promo.type === "member"
		? `${promo.value}% off tiers`
		: promo.type === "dollar"
			? formatMoney(promo.value, currency)
			: countOf(promo.value, unit);

/** The create dialog's preview line (mockup `ACT.code.prev`): what the code will do, or why it cannot be made yet. The
 * bold part is `strong`; the rest is `before` and `after`. */
export type PreviewLine = {
	error: boolean;
	before: string;
	strong: string;
	after: string;
};

export function previewLine(
	type: PromoType,
	value: string,
	expires: string,
	unit: CreditUnit,
	currency: string,
): PreviewLine {
	const amount = Number(value);
	if (!(amount > 0))
		return {
			error: true,
			before: "",
			strong: "Enter a value above 0.",
			after: "",
		};
	if (type === "member" && amount > 100)
		return {
			error: true,
			before: "",
			strong: "A percentage can't exceed 100.",
			after: "",
		};
	if (type === "member")
		return {
			error: false,
			before: "Members get ",
			strong: `${amount}% off`,
			after: ` membership tiers at checkout until ${expires}. ${capitalise(unit.other)} granted stay full. One code per checkout.`,
		};
	if (type === "dollar")
		return {
			error: false,
			before: "A one-use Stripe promotion code worth ",
			strong: formatMoney(Math.round(amount * 100), currency),
			after: `, expiring ${expires}. Nothing is booked until it is sold or redeemed.`,
		};
	return {
		error: false,
		before: "Redeeming grants ",
		strong: countOf(amount, unit),
		after: ` once, expiring ${expires}. No money moves in Stripe.`,
	};
}
