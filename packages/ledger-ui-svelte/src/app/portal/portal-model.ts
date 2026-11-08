import { cutoffHours } from "$contract/app/booking-text.ts";
import { monthAndDay, monthName } from "$contract/app/period.ts";
import { count } from "$contract/app/portal-format.ts";
import { audienceNames } from "$contract/data/disclosure.ts";
import type {
	DocumentPeriod,
	KpiDocument,
} from "$contract/data/kpi-document.ts";
import {
	type FamilyRole,
	type HistoryPeriod,
	historyPeriods,
	type MemberPortal,
	type PortalAudience,
	type PortalBooking,
	type PortalHistoryRow,
	type SiteThemeId,
	siteThemeIds,
} from "$contract/data/portal.ts";
import type { Clock, School } from "$contract/data/types.ts";
import { formatMoney } from "../books-shared/books-text.ts";
import type { PaneIconName } from "../pane-icons.ts";

/** What the member portal shows that is not markup: the route's parameters, the texts of the School books card, and the
 * lines under a booking (the Preact package's portal.tsx and portal-views.tsx keep these inside components that import
 * Preact; test/s9-5/consistency.test.ts compares them). The plan, the counts and the CSV columns come from the
 * Preact package's portal-format.ts, which imports no Preact. */

export const previewTitle = "Exit preview to act";
const minutesPerMillisecond = 1 / 60_000;
const percentScale = 100;

export type PortalTab = "overview" | "bookings" | "billing" | "family";
export const defaultTab: PortalTab = "overview";
export const defaultTheme: SiteThemeId = "b4u";
export const defaultPeriod: HistoryPeriod = "all";
export const tabs: Array<{ id: PortalTab; label: string; icon: PaneIconName }> =
	[
		{ id: "overview", label: "Overview", icon: "user" },
		{ id: "bookings", label: "Bookings", icon: "calendar" },
		{ id: "billing", label: "Billing", icon: "card" },
		{ id: "family", label: "Family", icon: "users" },
	];
/** The parameters that open the portal and shape it; Exit removes them all. */
export const portalParameters = [
	"portal",
	"portalTab",
	"siteTheme",
	"history",
	"historyAll",
];

/** `portalTab=overview|bookings|billing|family` (absent: overview). */
export const readTab = (query: URLSearchParams): PortalTab =>
	tabs.find(({ id }) => id === query.get("portalTab"))?.id ?? defaultTab;
/** `siteTheme=b4u|host|dark` (absent: b4u). */
export const readTheme = (query: URLSearchParams): SiteThemeId =>
	siteThemeIds.find((id) => id === query.get("siteTheme")) ?? defaultTheme;
/** `history=all|this|last` (absent: all). */
export const readPeriod = (query: URLSearchParams): HistoryPeriod =>
	historyPeriods.find(({ id }) => id === query.get("history"))?.id ??
	defaultPeriod;

/** What the School books card says about each audience. The document's own policy is not in the Reader yet (S7's
 * `Disclosure`), so these lines are the mockup's. */
export const booksCopy: Record<PortalAudience, string> = {
	public:
		"Public document: years, money rounded to $100, published 12 months after a year closes. Totals and categories only.",
	member:
		"Member document: Quarters, 6 weeks after each closes, money rounded to $100, totals and categories only.",
	governance:
		"Governance document: months, exact, with plan and fund breakdowns and how gifts spread. No names or per-person rows.",
	finance:
		"Finance admin: everything in the admin dashboard, names included. Opened with your PIN.",
	owner:
		"Owner: everything in the admin dashboard, names included. Opened with your PIN.",
};
export const booksActions: Partial<
	Record<PortalAudience, { label: string; icon: PaneIconName; toast: string }>
> = {
	member: {
		label: "Open school books",
		icon: "scale",
		toast: "Opening the school's books…",
	},
	governance: {
		label: "Open the governance view",
		icon: "users",
		toast: "Opening the governance view of the school's books…",
	},
};

/** The newest period the document shows its money for. */
export const publishedPeriod = (
	document: KpiDocument,
): DocumentPeriod | undefined =>
	document.periods.filter(({ state }) => state === "shown").at(-1);

/** `5 Nov 2026`. */
export const dayMonthYear = (date: string): string =>
	`${Number(date.slice(8))} ${monthName(date)} ${date.slice(0, 4)}`;

/** The bookings of one person, soonest first (the document lists them that way). */
export const bookingsOf = (
	portal: MemberPortal,
	profileId: string,
): PortalBooking[] =>
	portal.bookings.filter((booking) => booking.profileId === profileId);

const minutesUntil = (now: string, wallTime: string): number =>
	(Date.parse(`${wallTime}:00Z`) - Date.parse(`${now}:00Z`)) *
	minutesPerMillisecond;

/** The line under a booking: what it holds or cost, and whether it can still be cancelled free (mockup `mpBk`). */
export function bookingTail(
	booking: PortalBooking,
	clock: Clock,
	school: School,
): string {
	const cost =
		booking.paidCents === null
			? booking.held > 0
				? `${count(booking.held, school.creditUnit)} held`
				: "Free"
			: `Paid ${formatMoney(booking.paidCents, school.currency)}`;
	const started = booking.startsAt < clock.now;
	if (started || booking.state === "requested") return cost;
	const cutoff = cutoffHours(booking.cutoffMinutes);
	return minutesUntil(clock.now, booking.startsAt) < booking.cutoffMinutes
		? `${cost} · inside the ${cutoff} cutoff`
		: `${cost} · free to cancel until ${cutoff} before`;
}

export const hostNames = (booking: PortalBooking): string =>
	booking.hosts.map(({ name }) => name).join(", ");
export const whenOf = (booking: PortalBooking): string =>
	`${monthAndDay(booking.startsAt.slice(0, 10))} ${booking.startsAt.slice(11)}`;

const roleLabels: Record<FamilyRole, string> = {
	adult: "Adult",
	teen: "Teen",
	child: "Child",
};
export const familyRoleLabel = (role: FamilyRole): string => roleLabels[role];

/** `Nov 3, 2026`. */
export const dayText = (date: string): string =>
	`${monthAndDay(date)}, ${date.slice(0, 4)}`;

export type PillTone = "paid" | "failed" | "other";
export const pillTone = (status: PortalHistoryRow["status"]): PillTone => {
	if (status === "paid") return "paid";
	return status === "failed" ? "failed" : "other";
};

/** The widths of the used, held and available segments of a balance's bar, in percent with one decimal. */
export function barWidths(balance: {
	used: number;
	held: number;
	available: number;
}): { used: string; held: string; available: string } {
	const total = Math.max(balance.used + balance.held + balance.available, 1);
	const width = (value: number): string =>
		`${((value / total) * percentScale).toFixed(1)}%`;
	return {
		used: width(balance.used),
		held: width(balance.held),
		available: width(balance.available),
	};
}

/** The scope banner's "In this portal" line. */
export function scopeText(
	portal: MemberPortal,
	viewed: { name: string },
): string {
	if (portal.scope === "family" && portal.family)
		return `${portal.people.map(({ name }) => name).join(", ")} (${portal.family.label})`;
	return portal.family
		? `${viewed.name} only. Learners don't see other family members' money.`
		: `${viewed.name} only (no family on this account).`;
}

/** The School books pill. */
export const booksPill = (
	audience: PortalAudience,
	guardian: boolean,
): string => (guardian ? "Via guardian" : audienceNames[audience]);

/** What the member's view can ask its host to do. */
export type Handlers = {
	onQuantity: () => void;
	onCancel: () => void;
	onResume: () => void;
	onCard: () => void;
	onBuy: (addonId: string) => void;
	onBooks: (toast: string) => void;
	onCancelBooking: (booking: PortalBooking) => void;
};

export type HistoryControls = {
	/** Money per person is for the owner and finance admins: another admin's preview shows no amounts and cannot export. */
	finance: boolean;
	period: HistoryPeriod;
	expanded: boolean;
	onPeriod: (period: HistoryPeriod) => void;
	onExpand: () => void;
	onDownload: (rows: PortalHistoryRow[]) => void;
};
