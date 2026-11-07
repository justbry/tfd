import type {
	DetailStep,
	DisclosureDelay,
	DisclosureGrain,
} from "./kpi-disclosure.js";

/** What `audienceViews` returns for each audience (`AudienceView`) and the pieces it is made of: a copy, byte for byte, of
 * the block of `packages/ledger-ui/src/data/disclosure.ts` from `HiddenReason` to `AudienceView`, so the Worker imports
 * nothing from the UI package. `tests/audience-views.test.ts` fails if the two drift. */

/** Why a figure or a surface is not shown: `embargoed` (inside its delay: "Published after 7 Jan 2027"),
 * `members_only` (a public viewer: "Members see this"), `no_grant` (an audience further up sees it). */
export type HiddenReason = "embargoed" | "members_only" | "no_grant";
/** A lock panel's code: a hidden reason, or `admins_only` (owners and admins only, not a books surface). */
export type LockReason = HiddenReason | "admins_only";
/** What a gated surface shows instead of its figures: `who` may see it (the panel's heading, e.g. "Governance and up
 * see this") and `when` (the line under it: how fine and how soon they see it, or the day it publishes). */
export type LockPanel = { reason: LockReason; who: string; when: string };
/** The gated surfaces whose lock panels the fixtures carry: the Dashboard's "By plan or fund" (revenue_by_tier at
 * breakdown), the Plans tab's members and revenue per plan (revenue_by_tier at breakdown), and the Settings drawer's
 * School books table. */
export const gatedSurfaces = [
	"dashboard-plan",
	"plans-revenue",
	"settings-books",
] as const;
export type GatedSurface = (typeof gatedSurfaces)[number];

/** A period the period selector offers an audience below `finance` (its grain, mockup `pList`): `YYYY`, `YYYY-Qn` or
 * `YYYY-MM`, its label (`2024`, `Q1 2025`, `Jan 2026`) and dates. An embargoed or future one is listed but disabled
 * with its `title` ("Published after 7 Jan 2027", "Not started yet"). */
export type PeriodGate = {
	period: string;
	label: string;
	from: string;
	to: string;
	state: "shown" | "embargoed" | "future";
	title: string | null;
};
/** The period control's eight presets (mockup `PRE`, by label; S0's golden lists them) for an audience: hidden with the reason and title
 * the mockup gives ("Governance and up see this: Public sees years"), or embargoed with its publish line. A hidden
 * preset's second line is "—", an embargoed one's its title. */
export type PresetGate = {
	label:
		| "This month"
		| "Last month"
		| "This quarter"
		| "Last quarter"
		| "Last 3 months"
		| "This year"
		| "Last year"
		| "Year to date";
	state: "shown" | "hidden" | "embargoed";
	reason: HiddenReason | null;
	title: string | null;
};

/** One audience as this school's documents give it, worked out by the server at the clock. */
export type AudienceView = {
	name: string;
	/** The View as option's second line (mockup `vaSummary`). */
	summary: string;
	/** Finance and owner read live: every period, months and days, the open month included. */
	live: boolean;
	identities: boolean;
	/** The finest detail any class gives this audience. */
	detail: DetailStep;
	/** The grain and delay of its income figures (the period selector's grain); `day` when live. */
	grain: DisclosureGrain;
	delay: DisclosureDelay | null;
	/** Money rounding for this school's size and year, minor units; 0 is exact. */
	roundTo: number;
	/** Below `finance`, a count that fails the cell rules (fewer than `fewerThan` holders) shows rounded to `roundTo`,
	 * 1 to 9 as `under`; null when the rules are off. */
	smallCounts: { fewerThan: number; roundTo: number; under: string } | null;
	cellRules: "on" | "breakdown and spread" | "off";
	/** The audience opens the books with the family PIN. */
	pin: boolean;
	/** "Public sees years": the tail of a hidden preset's title and of the period-changed toast. */
	sees: string;
	/** The selector's line under its label, after "Previewing " when the audience is a preview: "Public: years only.
	 * One period for Dashboard, Reports, Ledger and Members." */
	periodNote: string;
	/** The custom range's note when the audience has no days ("Days show to finance admins and the owner. Public sees
	 * years."); null when live (the date inputs show). */
	customRangeNote: string | null;
	presets: PresetGate[];
	/** Empty when live. */
	periods: PeriodGate[];
};
