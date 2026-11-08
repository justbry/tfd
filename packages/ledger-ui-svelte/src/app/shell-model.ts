import { type Period, parsePeriod } from "$contract/app/period.ts";
import { allSchools, type SchoolTab } from "$contract/app/route.ts";
import type { School } from "$contract/data/types.ts";
import type { IconName } from "./icons.ts";

/** The shell's data that is not markup: tab names, badges, the period a route shows. */

export const tabNames: Record<
	SchoolTab,
	{ label: string; icon: IconName; slice: string }
> = {
	plans: { label: "Plans", icon: "layers", slice: "S9.3" },
	dashboard: { label: "Dashboard", icon: "chart", slice: "S9.1" },
	members: { label: "Members", icon: "users", slice: "S9.2" },
	bookings: { label: "Bookings", icon: "calendar", slice: "S9.2" },
	promos: { label: "Promos", icon: "tag", slice: "S9.3" },
	ledger: { label: "Ledger", icon: "list", slice: "S9.4" },
	reports: { label: "Reports", icon: "chart", slice: "S9.4" },
};

export type TabBadge = {
	text: string;
	/** What a screen reader hears for the badge. */
	meaning: string;
	tone: "warning" | "bad";
};

const counted = (count: number, noun: string): string =>
	`${count} ${noun}${count === 1 ? "" : "s"}`;

/** A tab's badge from the school's counts (mockup `#plbadge`, `#bkbadge`, `#pbadge`), as the Preact shell's
 * `tabBadge`; none when the school has no counts (`tabBadges` null), never 0. The Plans draft badge follows `plansDraftNow` once
 * the Plans tab has worked it out. */
export function tabBadge(
	tab: SchoolTab,
	{ tabBadges }: School,
	plansDraftNow?: boolean,
): TabBadge | null {
	if (!tabBadges) return null;
	const { bookingsOverdue, promosExpiring } = tabBadges;
	const plansDraft = plansDraftNow ?? tabBadges.plansDraft;
	if (tab === "plans" && plansDraft)
		return { text: "draft", meaning: "draft", tone: "warning" };
	if (tab === "bookings" && bookingsOverdue > 0)
		return {
			text: String(bookingsOverdue),
			meaning: counted(bookingsOverdue, "overdue booking"),
			tone: "bad",
		};
	if (tab === "promos" && promosExpiring > 0)
		return {
			text: String(promosExpiring),
			meaning: counted(promosExpiring, "expiring promo"),
			tone: "warning",
		};
	return null;
}

/** The tabs whose panes open on the school's `dashboardOpensOn` month when the route names none (the Preact
 * package's `opensOnTabs` in viewing.ts, which imports Preact and so cannot be imported here; test/s9-0 compares). */
export const opensOnTabs: ReadonlySet<string> = new Set([
	"plans",
	"dashboard",
	"members",
]);

/** The money period a route asks for, before the shell snaps it to what the viewed audience may pick (the Preact
 * `viewedPeriod`, whose snap needs the disclosure). */
export function shownPeriod(
	asked: string | null,
	today: string,
	tab: string,
	school: School | undefined,
): Period {
	const fallback = opensOnTabs.has(tab)
		? (school?.dashboardOpensOn ?? null)
		: null;
	return parsePeriod(asked ?? fallback, today);
}

/** The switcher row's accessible name: the school, stale, and how many need attention. */
export const schoolLabel = (school: School): string =>
	[
		school.name,
		school.stale ? "stale" : "",
		school.attentionCount !== null && school.attentionCount > 0
			? `${school.attentionCount} need attention`
			: "",
	]
		.filter(Boolean)
		.join(", ");

/** The stale banner's text (mockup `#bnr`). */
export const staleText = (school: School): string =>
	`Data is ${school.lagMinutes} min behind: the shipper may be stuck. Recent events can be missing.`;

/** The props a pane loaded on demand takes (the generics of `LazyPane`). */
export type PaneProps = Record<string, unknown>;

/** The panes that read the school's disclosure (View as, the audience's limits) before they show anything. */
export const readsDisclosure = (
	tab: string,
): tab is "dashboard" | "bookings" | "members" | "plans" | "promos" =>
	tab === "dashboard" ||
	tab === "bookings" ||
	tab === "members" ||
	tab === "plans" ||
	tab === "promos";

/** The tabs whose pane reports its own render (it is loaded on demand, or it loads data, so the route is on screen only
 * once the pane, its data or its message is): the others are on screen as soon as the shell is. */
export const reportsItsOwnRender = (tab: string): boolean =>
	readsDisclosure(tab) || tab === allSchools;
