/**
 * XML Schema 1.1 `dateTimeStamp` (a dateTime with a required time zone), the type VC DM 2.0 §4.9 requires for
 * `validFrom`/`validUntil` and Data Integrity requires for `created`/`expires`. Parsed by hand to an instant in ms so
 * every runtime agrees: `Date.parse` differs between engines on fractional seconds and odd offsets.
 */
import { CredentialsError } from "./errors.js";

const DATE_TIME_STAMP =
	/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/;

const MAX_OFFSET_MINUTES = 14 * 60;

const daysInMonth = (year: number, month: number): number =>
	new Date(Date.UTC(year, month, 0)).getUTCDate();

/** The instant in ms, or null when `text` is not a dateTimeStamp. Years 0000–9999 only, no leap seconds. */
export const parseDateTimeStamp = (text: string): number | null => {
	const match = DATE_TIME_STAMP.exec(text);
	if (match === null) return null;
	const [year, month, day, hour, minute, second] = match
		.slice(1, 7)
		.map(Number) as [number, number, number, number, number, number];
	if (month < 1 || month > 12) return null;
	if (day < 1 || day > daysInMonth(year, month)) return null;
	// 24:00:00 is the XSD spelling of the next midnight; nothing else may use hour 24.
	const endOfDay = hour === 24 && minute === 0 && second === 0;
	if ((hour > 23 && !endOfDay) || minute > 59 || second > 59) return null;
	const fraction = match[7];
	if (endOfDay && fraction !== undefined && Number(fraction) !== 0) return null;
	let offsetMinutes = 0;
	if (match[8] !== "Z") {
		const offsetHours = Number(match[10]);
		const offsetRest = Number(match[11]);
		if (offsetRest > 59) return null;
		offsetMinutes = offsetHours * 60 + offsetRest;
		if (offsetMinutes > MAX_OFFSET_MINUTES) return null;
		if (match[9] === "-") offsetMinutes = -offsetMinutes;
	}
	const date = new Date(0);
	date.setUTCFullYear(year, month - 1, day);
	date.setUTCHours(hour, minute, second, 0);
	const milliseconds =
		fraction === undefined ? 0 : Math.floor(Number(`0${fraction}`) * 1000);
	return date.getTime() + milliseconds - offsetMinutes * 60_000;
};

/** An instant as `YYYY-MM-DDTHH:MM:SSZ`, with `.sss` only when the milliseconds are not zero. */
export const formatDateTimeStamp = (ms: number): string => {
	if (!Number.isFinite(ms)) {
		throw new CredentialsError(
			"datetime_invalid",
			"now must be a finite ms timestamp",
		);
	}
	const text = new Date(ms).toISOString();
	return text.endsWith(".000Z") ? `${text.slice(0, -5)}Z` : text;
};

/** The same calendar date and time one year later in UTC (29 February becomes 1 March). */
export const oneYearLater = (ms: number): number => {
	const date = new Date(ms);
	date.setUTCFullYear(date.getUTCFullYear() + 1);
	return date.getTime();
};
