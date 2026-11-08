import { type Period, periodWord } from "$contract/app/period.ts";
import type { SaveStatus } from "./plans-menu.ts";
import { exitPreviewTitle } from "./notify.ts";

export type SetupStepKey = "stripe" | "plan" | "publish" | "link";
export type SetupStep = {
	key: SetupStepKey;
	title: string;
	detail: string;
	done: boolean;
};

/** Mockup `setupSteps`: what a school does before it sells (the Preact package's plan-overview.tsx). */
export const setupSteps = (facts: {
	stripeConnected: boolean;
	hasDraftMembership: boolean;
	hasPublishedPlans: boolean;
	purchaseLinkShared: boolean;
}): SetupStep[] => [
	{
		key: "stripe",
		title: "Connect Stripe",
		detail: "Take payments through your own account",
		done: facts.stripeConnected,
	},
	{
		key: "plan",
		title: "Add a membership",
		detail: "Name it, price it, say what members get",
		done: facts.hasDraftMembership,
	},
	{
		key: "publish",
		title: "Publish your plans",
		detail: "Makes them available to buy",
		done: facts.hasPublishedPlans,
	},
	{
		key: "link",
		title: "Share your purchase link",
		detail: "Copy it into your website or email",
		done: facts.purchaseLinkShared,
	},
];

const lastDayOfMonth = (year: number, month: number): number =>
	new Date(Date.UTC(year, month, 0)).getUTCDate();

/** The month the Plans strip reads from the viewed period (mockup `syncDm`): the period's last month, held to the
 * clock's month when the period is in the clock's year and is a quarter, a year or days rather than months;
 * `YYYY-MM-01`. The contract's `monthOfPeriod`, written out here because that function sits in the first page load's
 * chunk, which a lazy pane's use of it would grow (test/s9-3/model-drift.test.ts compares the two). */
export function viewedMonthOf(period: Period, today: string): string {
	const ending = period.to.slice(0, 7);
	const wholeMonths =
		period.from.endsWith("-01") &&
		Number(period.to.slice(8, 10)) ===
			lastDayOfMonth(Number(period.to.slice(0, 4)), Number(period.to.slice(5, 7)));
	const word = periodWord(period);
	const monthly = word === "Month" || (word === "Custom" && wholeMonths);
	return `${
		period.to.slice(0, 4) === today.slice(0, 4) && !monthly && ending > today.slice(0, 7)
			? today.slice(0, 7)
			: ending
	}-01`;
}

/** Mockup `#prev`'s title: why Review and publish is off, or nothing when it is on. */
export function reviewReason(facts: {
	preview: boolean;
	/** The Code view's text does not parse, so the draft is not what the text says. */
	yamlBroken: boolean;
	problemCount: number;
	stripeConnected: boolean;
	saveStatus: SaveStatus;
	changeCount: number;
}): string | undefined {
	if (facts.preview) return exitPreviewTitle;
	if (facts.yamlBroken) return "Fix the YAML first";
	if (facts.problemCount > 0) return "Fix the problems first";
	if (!facts.stripeConnected) return "Connect Stripe first";
	if (facts.saveStatus === "saving") return "Saving the draft…";
	if (facts.saveStatus === "failed")
		return "The draft could not be saved. Retry the save first";
	return facts.changeCount > 0 ? undefined : "Nothing to publish";
}
