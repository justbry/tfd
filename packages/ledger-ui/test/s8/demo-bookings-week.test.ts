import { afterEach, expect, test } from "bun:test";
import {
	bookingsOpenOffset,
	bookingsPeriodRoute,
	readBookingsPeriod,
} from "../../src/app/bookings-period.ts";
import { parseRoute } from "../../src/app/route.ts";
import type { Reader } from "../../src/data/reader.ts";
import { createFixtureReader } from "../../src/fixtures/reader.ts";
import { cleanUp, clock, open, text } from "../s5/helpers.ts";

/**
 * A demo school's Bookings tab opens on the week of its latest booking when that lies before this week
 * (`School.bookingsOpenOn`, S8-contract section 11 "Demo schools"): seven of the fifteen scenarios end in June, and
 * this week would show none of their bookings. Every other school, and a demo school whose bookings reach this week,
 * opens on this week; a period picked in the control stays in the route.
 */
afterEach(cleanUp);

test("the opening week: the latest booking's week when it lies before this one, else this week", () => {
	// 2026-11-05 is a Thursday; its week starts Monday 2026-11-02.
	expect(bookingsOpenOffset(undefined, "2026-11-05")).toBe(0);
	expect(bookingsOpenOffset({}, "2026-11-05")).toBe(0);
	expect(
		bookingsOpenOffset({ bookingsOpenOn: "2026-11-02" }, "2026-11-05"),
	).toBe(0);
	expect(
		bookingsOpenOffset({ bookingsOpenOn: "2026-12-28" }, "2026-11-05"),
	).toBe(0);
	expect(
		bookingsOpenOffset({ bookingsOpenOn: "2026-11-01" }, "2026-11-05"),
	).toBe(-1);
	expect(
		bookingsOpenOffset({ bookingsOpenOn: "2026-06-30" }, "2026-11-05"),
	).toBe(-18);
});

test("a week with no offset in the route is the opening week; a picked one is kept, This week too", () => {
	const none = new URLSearchParams();
	expect(readBookingsPeriod(none, -18)).toEqual({ range: "week", offset: -18 });
	expect(readBookingsPeriod(new URLSearchParams("range=day"), -18)).toEqual({
		range: "day",
		offset: 0,
	});
	const route = parseRoute("#/vol/bookings", ["vol"]);
	const thisWeek = bookingsPeriodRoute(
		route,
		{ range: "week", offset: 0 },
		-18,
	);
	expect(thisWeek.query.get("offset")).toBe("0");
	expect(readBookingsPeriod(thisWeek.query, -18)).toEqual({
		range: "week",
		offset: 0,
	});
	const opening = bookingsPeriodRoute(
		route,
		{ range: "week", offset: -18 },
		-18,
	);
	expect(opening.query.get("offset")).toBeNull();
	expect(
		bookingsPeriodRoute(route, { range: "week", offset: 0 }).query.get(
			"offset",
		),
	).toBeNull();
});

test("a demo school whose bookings ended in June opens its Bookings on that week", async () => {
	const base = createFixtureReader({ clock });
	const reader: Reader = {
		...base,
		schools: async () =>
			(await base.schools()).map((school) =>
				school.id === "vol"
					? { ...school, demo: true, bookingsOpenOn: "2026-06-10" }
					: school,
			),
	};
	await open("#/vol/bookings", { reader });
	expect(text("[data-test=booking-range-label]")).toBe("Week of Jun 8");
	cleanUp();
	await open("#/b4u/bookings", { reader });
	expect(text("[data-test=booking-range-label]")).toBe("This week");
});
