import { addDays, monthAndDay, weekdayName, weekStart } from "./period.ts";
import { type Route, withQuery } from "./route.ts";

/** The Bookings tab's period (S2's hash grammar): `range=day|week` (absent: week) and `offset=<n>` (absent: 0). A day
 * is `offset` days from the clock's today, a week is Monday to Sunday, `offset` weeks from the week that holds today.
 * Unlike the money period it may lie after today (bookings ahead). */
export type BookingsPeriod = { range: "day" | "week"; offset: number };

const daysPerWeek = 7;
const msPerWeek = daysPerWeek * 86_400_000;

/** The week the Bookings tab opens on, in weeks from this one: a demo school whose latest booking lies before this
 * week opens on that booking's week (`School.bookingsOpenOn`), so its tab is not empty; any other school on this
 * week. */
export function bookingsOpenOffset(
	school: { bookingsOpenOn?: string } | undefined,
	today: string,
): number {
	const opensOn = school?.bookingsOpenOn;
	if (!opensOn) return 0;
	const weeks = Math.round(
		(Date.parse(weekStart(opensOn)) - Date.parse(weekStart(today))) / msPerWeek,
	);
	return Math.min(0, weeks);
}

/** The period of a route; a week with no `offset` is `opensOffset` weeks from this one (`bookingsOpenOffset`). */
export function readBookingsPeriod(
	query: URLSearchParams,
	opensOffset = 0,
): BookingsPeriod {
	const range = query.get("range") === "day" ? "day" : "week";
	const asked = query.get("offset");
	const offset = Number(asked ?? 0);
	if (asked === null)
		return { range, offset: range === "week" ? opensOffset : 0 };
	return { range, offset: Number.isInteger(offset) ? offset : 0 };
}

/** The route for a period: the defaults (week, the opening offset; a day, offset 0) are left out of the hash; every
 * other parameter stays. */
export function bookingsPeriodRoute(
	route: Route,
	{ range, offset }: BookingsPeriod,
	opensOffset = 0,
): Route {
	const opening = range === "week" ? opensOffset : 0;
	return withQuery(
		withQuery(route, "range", range === "day" ? "day" : null),
		"offset",
		offset === opening ? null : String(offset),
	);
}

/** The days a period covers (mockup `bRange`). */
export function bookingsDays(
	{ range, offset }: BookingsPeriod,
	today: string,
): { from: string; to: string } {
	if (range === "day") {
		const day = addDays(today, offset);
		return { from: day, to: day };
	}
	const from = addDays(weekStart(today), offset * daysPerWeek);
	return { from, to: addDays(from, daysPerWeek - 1) };
}

/** The mockup's `bLabel`. */
export function bookingsLabel(
	{ range, offset }: BookingsPeriod,
	from: string,
): string {
	if (range === "day") {
		const names = ["Yesterday", "Today", "Tomorrow"];
		return names[offset + 1] ?? `${weekdayName(from)} ${monthAndDay(from)}`;
	}
	const names = ["Last week", "This week", "Next week"];
	return names[offset + 1] ?? `Week of ${monthAndDay(from)}`;
}

/** The control's four choices (mockup `renderPP` on Bookings). */
export const bookingsChoices: Array<BookingsPeriod & { label: string }> = [
	{ label: "Today", range: "day", offset: 0 },
	{ label: "Tomorrow", range: "day", offset: 1 },
	{ label: "This week", range: "week", offset: 0 },
	{ label: "Next week", range: "week", offset: 1 },
];
