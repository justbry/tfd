/**
 * `GET /v1/schools/:school/demo-api/<route>` (S8-contract section 11 "Demo schools"): a demo school's answer to one of
 * the buzz-school reads the ledger UI makes, as the seed or the views job stored it (`demo/demo-api-store.ts`), in the
 * section 11 envelope. `bookings` takes buzz-school's `from` and `to` (school-local days, at most 62 of them) and
 * answers the bookings that start on those days. A route the events cannot answer is `501 not_available`; one with no
 * stored answer (a menu version that does not exist) is `404 not_found`.
 */

import type { Store } from "../data/store-io.js";
import { textOf } from "../data/store-io.js";
import { DEMO_NOT_AVAILABLE, demoApiKey } from "../demo/demo-api-store.js";
import { ApiError, okResponse } from "../http.js";
import { daysInRange, localWallTime } from "../time.js";
import { dayRange } from "./query.js";
import { freshnessOf } from "./schools.js";

const ROUTE =
	/^(ledger\/school|ledger\/capabilities|billing\/members-list|billing\/menu\/versions(\/[0-9]{1,9})?|bookings|finance-grants)$/;
/** buzz-school's `MAX_BOOKING_DAYS`. */
const MAX_BOOKING_DAYS = 62;
const MS_PER_SECOND = 1000;
const LOCAL_DAY_LENGTH = 10;

type StoredBookings = {
	timeZone: string;
	bookings: Array<{ startsAt: number }>;
};

const parsed = (text: string): unknown => {
	try {
		return JSON.parse(text);
	} catch {
		throw new ApiError("views_unavailable", "The demo answer cannot be read.");
	}
};

/** The stored bookings that start on `from` to `to` in the school's zone. */
const bookingsIn = (stored: StoredBookings, query: URLSearchParams) => {
	const { from, to } = dayRange(query);
	if (daysInRange(from, to) > MAX_BOOKING_DAYS)
		throw new ApiError(
			"bad_request",
			`A page holds at most ${MAX_BOOKING_DAYS} days.`,
			{ field: "to" },
		);
	return {
		...stored,
		bookings: stored.bookings.filter((booking) => {
			const day = localWallTime(
				booking.startsAt * MS_PER_SECOND,
				stored.timeZone,
			).slice(0, LOCAL_DAY_LENGTH);
			return day >= from && day <= to;
		}),
	};
};

export const demoApiRoute = async (
	store: Store,
	school: string,
	route: string,
	query: URLSearchParams,
	now: number,
): Promise<Response> => {
	if (!ROUTE.test(route)) throw new ApiError("not_found", "No such endpoint.");
	const text = await textOf(store, demoApiKey(school, route));
	if (text === null) {
		const listed = await textOf(store, demoApiKey(school, DEMO_NOT_AVAILABLE));
		const reasons = listed === null ? null : parsed(listed);
		const reason =
			typeof reasons === "object" && reasons !== null
				? (reasons as Record<string, unknown>)[route]
				: undefined;
		if (typeof reason === "string")
			throw new ApiError(
				"not_available",
				`Not available for this demo school: ${reason}.`,
			);
		throw new ApiError("not_found", "No such answer.");
	}
	const answer = parsed(text);
	const data =
		route === "bookings" ? bookingsIn(answer as StoredBookings, query) : answer;
	return okResponse(data, await freshnessOf(store, school, now));
};
