/** Calendar helpers on the school's local days (`YYYY-MM-DD`) and the school's clock. */

const DAY_MS = 86_400_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const isDay = (value: string): boolean =>
	DAY.test(value) &&
	!Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
	toDay(Date.parse(`${value}T00:00:00Z`)) === value;

export const toDay = (milliseconds: number): string =>
	new Date(milliseconds).toISOString().slice(0, 10);

export const dayNumber = (day: string): number =>
	Date.parse(`${day}T00:00:00Z`);

export const addDays = (day: string, days: number): string =>
	toDay(dayNumber(day) + days * DAY_MS);

/** Whole days from `from` to `to`, both counted: the length of the range. */
export const daysInRange = (from: string, to: string): number =>
	(dayNumber(to) - dayNumber(from)) / DAY_MS + 1;

const formats = new Map<string, Intl.DateTimeFormat>();

/** `instant` as the local wall time of `timeZone`, `YYYY-MM-DDTHH:MM`; UTC for a zone this runtime does not know. */
export const localWallTime = (instant: number, timeZone: string): string => {
	let format = formats.get(timeZone);
	if (format === undefined) {
		try {
			format = new Intl.DateTimeFormat("en-CA", {
				timeZone,
				year: "numeric",
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
				hourCycle: "h23",
			});
		} catch {
			return new Date(instant).toISOString().slice(0, 16);
		}
		formats.set(timeZone, format);
	}
	const parts = Object.fromEntries(
		format
			.formatToParts(new Date(instant))
			.map((part) => [part.type, part.value]),
	);
	return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};
