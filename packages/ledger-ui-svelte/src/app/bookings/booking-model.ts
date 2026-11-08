import { cutoffHours } from "$contract/app/booking-text.ts";
import {
	type Booking,
	type BookingBilling,
	insideCutoff,
	needsOutcome,
} from "$contract/data/bookings.ts";
import type { Clock } from "$contract/data/types.ts";

/** What the Bookings pane works out of the Reader's list, as the Preact bookings.tsx does: no number but the rows
 * shown, and `needsOutcome` and `insideCutoff` of the contract as the only rules. */

export type Filter = "outcome" | "approval" | "cutoff";
export const filterOf = (value: string | null): Filter | null =>
	value === "outcome" || value === "approval" || value === "cutoff"
		? value
		: null;

/** Brief A caps a range at 62 days: the overdue group reads that many days before the range. */
export const overdueDays = 62;
/** The title of a write control while previewing. */
export const exitPreviewTitle = "Exit preview to act";
export const refundTitle = "Refunds from this tab are not available yet.";
export const bookingsNote =
	"Credits are reserved when a booking is made, spent when it's attended, and released when it's cancelled before the item's cutoff. Cutoffs come from each item, not one school-wide number.";

export const byStart = (first: Booking, second: Booking): number =>
	first.startsAt.localeCompare(second.startsAt);
export const dayOf = ({ startsAt }: Booking): string => startsAt.slice(0, 10);
export const attendeeName = ({ attendee }: Booking): string =>
	attendee?.name ?? "Guest";

export type Check = (booking: Booking) => boolean;

export type StatusBadge = { text: string; tone: "warning" | "bad" | null };

/** The status badges (mockup `bkStatus`): the write waiting to ship, else what the booking is waiting for. */
export function statusBadges(
	booking: Booking,
	pending: boolean,
	clock: Clock,
): StatusBadge[] {
	const badges: StatusBadge[] = [];
	if (pending) badges.push({ text: "pending", tone: "warning" });
	if (booking.state === "requested")
		badges.push({ text: "Waiting for approval", tone: "warning" });
	if (needsOutcome(booking, clock) && !pending)
		badges.push({ text: "Needs outcome", tone: "bad" });
	else if (booking.cutoffMinutes !== null && insideCutoff(booking, clock))
		badges.push({
			text: `Inside ${cutoffHours(booking.cutoffMinutes)} cutoff`,
			tone: "warning",
		});
	else if (booking.attendance)
		badges.push({
			text: booking.attendance === "attended" ? "Attended" : "No-show",
			tone: null,
		});
	if (booking.seriesLabel)
		badges.push({ text: booking.seriesLabel, tone: null });
	return badges;
}

/** Which buttons a row offers (mockup `bkActions`): Remind host on a booking waiting for approval, Confirm attended
 * and No-show on one that needs an outcome, then by billing Cancel and refund (paid, off) or Release hold (held, or
 * not known); nothing on a free booking or one that has started. */
export type RowActions =
	| "pending"
	| "remind"
	| "outcome"
	| "refund"
	| "release"
	| "none";

export function rowActionsOf(
	booking: Booking,
	pending: boolean,
	clock: Clock,
): RowActions {
	if (pending) return "pending";
	if (booking.state === "requested") return "remind";
	if (needsOutcome(booking, clock)) return "outcome";
	if (booking.startsAt < clock.now || booking.billing?.kind === "free")
		return "none";
	return booking.billing?.kind === "paid" ? "refund" : "release";
}

export const billingKind = (billing: BookingBilling | undefined): string =>
	billing?.kind ?? "unknown";
