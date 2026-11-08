// Added by justbry/atm: rollover expiry counted on a time zone's calendar (org.config.rollover_time_zone).
import {
	type RolloverConfig,
	RolloverExpiryDurationType,
} from "@autumn/shared";

const DAY_MS = 86_400_000;
const SECOND_MS = 1000;

const WALL_CLOCK_FIELDS = {
	hourCycle: "h23",
	year: "numeric",
	month: "numeric",
	day: "numeric",
	hour: "numeric",
	minute: "numeric",
	second: "numeric",
} as const;

/** What a clock in `timeZone` shows at `instant`, written as the UTC instant with the same fields. */
const wallClockAt = (instant: number, timeZone: string): number => {
	const field: Record<string, number> = {};
	for (const part of new Intl.DateTimeFormat("en-US", {
		...WALL_CLOCK_FIELDS,
		timeZone,
	}).formatToParts(new Date(instant)))
		field[part.type] = Number(part.value);
	return (
		Date.UTC(
			field.year as number,
			(field.month as number) - 1,
			field.day as number,
			field.hour as number,
			field.minute as number,
			field.second as number,
		) +
		(instant % SECOND_MS)
	);
};

/** Whole months added to a UTC-written wall clock, the day clamped to the end of a shorter month (as date-fns `addMonths`). */
const addCalendarMonths = (wallClock: number, months: number): number => {
	const date = new Date(wallClock);
	const month = date.getUTCMonth() + months;
	const lastDay = new Date(
		Date.UTC(date.getUTCFullYear(), month + 1, 0),
	).getUTCDate();
	return Date.UTC(
		date.getUTCFullYear(),
		month,
		Math.min(date.getUTCDate(), lastDay),
		date.getUTCHours(),
		date.getUTCMinutes(),
		date.getUTCSeconds(),
		date.getUTCMilliseconds(),
	);
};

/**
 * `instant` plus whole months on `timeZone`'s calendar: the same wall-clock time, the day clamped to the end of a shorter
 * month. A wall time the clocks pass twice is its first instant; one they skip is read with the offset in force a day
 * before it. Reads no process time zone, so it gives the same instant on every machine.
 */
export const addMonthsInTimeZone = ({
	instant,
	months,
	timeZone,
}: {
	instant: number;
	months: number;
	timeZone: string;
}): number => {
	const target = addCalendarMonths(wallClockAt(instant, timeZone), months);
	const offsetAt = (at: number) => wallClockAt(at, timeZone) - at;
	const withOffsetBefore = target - offsetAt(target - DAY_MS);
	const withOffsetAfter = target - offsetAt(target + DAY_MS);
	const shown = [withOffsetBefore, withOffsetAfter]
		.filter((candidate) => wallClockAt(candidate, timeZone) === target)
		.sort((first, second) => first - second);
	return shown[0] ?? withOffsetBefore;
};

/**
 * When a rollover made at `cycleEndedAt` lapses when its months are counted on `timeZone`'s calendar; null for a
 * rollover that never lapses (the same cases as the shared `calculateNextExpiry`, which counts on the process's).
 */
export const zonedRolloverExpiry = ({
	cycleEndedAt,
	config,
	timeZone,
}: {
	cycleEndedAt: number;
	config: RolloverConfig;
	timeZone: string;
}): number | null => {
	if (config === null || config === undefined) return null;
	if (config.duration === RolloverExpiryDurationType.Forever) return null;
	return addMonthsInTimeZone({
		instant: cycleEndedAt,
		months: config.length,
		timeZone,
	});
};
