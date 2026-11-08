import { monthAndDay } from "$contract/app/period.ts";
import { type Route, withQuery } from "$contract/app/route.ts";

/** The Bookings tab's period, as the Preact package's bookings-period.ts has it (a copy: the weekday helpers it takes from
 * period.ts would otherwise be part of the first page load, which only this tab uses; test/s9-2 compares the two).
 * S2's hash grammar:: `range=day|week` (absent: week) and `offset=<n>` (absent: 0). A day
 * is `offset` days from the clock's today, a week is Monday to Sunday, `offset` weeks from the week that holds today.
 * Unlike the money period it may lie after today (bookings ahead). */
export type BookingsPeriod = { range: "day" | "week"; offset: number };

const daysPerWeek = 7;
const dayMilliseconds = 86_400_000;
export const addDays = (isoDate: string, days: number): string =>
	new Date(new Date(`${isoDate}T00:00:00Z`).getTime() + days * dayMilliseconds)
		.toISOString()
		.slice(0, 10);
const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const weekdayIndex = (isoDate: string): number =>
	new Date(`${isoDate}T00:00:00Z`).getUTCDay();
/** `Wed`. */
export const weekdayName = (isoDate: string): string =>
	weekdayNames[weekdayIndex(isoDate)] ?? "";
/** The Monday of the week that holds `isoDate`. */
const weekStart = (isoDate: string): string =>
	addDays(isoDate, -((weekdayIndex(isoDate) + daysPerWeek - 1) % daysPerWeek));

export function readBookingsPeriod(query: URLSearchParams): BookingsPeriod {
	const offset = Number(query.get("offset") ?? 0);
	return {
		range: query.get("range") === "day" ? "day" : "week",
		offset: Number.isInteger(offset) ? offset : 0,
	};
}

/** The route for a period: the defaults (week, offset 0) are left out of the hash; every other parameter stays. */
export function bookingsPeriodRoute(
	route: Route,
	{ range, offset }: BookingsPeriod,
): Route {
	return withQuery(
		withQuery(route, "range", range === "day" ? "day" : null),
		"offset",
		offset === 0 ? null : String(offset),
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
