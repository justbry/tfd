// SPDX-License-Identifier: Apache-2.0
/**
 * UTC instants as the events spell them (`2026-03-05T12:00:00Z`, optional fraction of a second). Shared by the event
 * validator, the approval rules and the grant fold so that they all order and add to an instant the same way. No clock.
 */

import { addDays, isValidCivilDate } from "./date";

const INSTANT_PATTERN =
	/^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,9})?Z$/;

/** True for an ISO 8601 UTC instant ending in `Z` whose date is a real calendar date. */
export const isInstant = (value: unknown): value is string => {
	const match = typeof value === "string" ? INSTANT_PATTERN.exec(value) : null;
	return match !== null && isValidCivilDate(match[1] ?? "");
};

/** Orders two valid instants, comparing fractional seconds as numbers (`.5Z` is after `Z` and before `.51Z`). */
export const compareInstants = (left: string, right: string): number => {
	const [leftSeconds = "", leftFraction = ""] = left.slice(0, -1).split(".");
	const [rightSeconds = "", rightFraction = ""] = right.slice(0, -1).split(".");
	if (leftSeconds !== rightSeconds) {
		return leftSeconds < rightSeconds ? -1 : 1;
	}
	const width = Math.max(leftFraction.length, rightFraction.length);
	const paddedLeft = leftFraction.padEnd(width, "0");
	const paddedRight = rightFraction.padEnd(width, "0");
	if (paddedLeft === paddedRight) {
		return 0;
	}
	return paddedLeft < paddedRight ? -1 : 1;
};

/** The same time of day, `days` calendar days later. `instant` must be valid; throws when the date passes year 9999. */
export const addDaysToInstant = (instant: string, days: number): string => {
	const [date = "", time = ""] = instant.split("T");
	return `${addDays(date, days)}T${time}`;
};
