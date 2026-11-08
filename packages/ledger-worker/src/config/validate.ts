/**
 * Hand-written validators for the config objects: no schema library, no `new Function` (a Worker refuses both). Each
 * returns every problem it finds, not the first, as `{ path, message, hint }`.
 */
import { type Problem, SCHEMA_VERSION } from "./types.js";

export const detailSteps = [
	"total",
	"categories",
	"breakdown",
	"spread",
	"rows",
	"names",
] as const;
export const disclosureGrains = ["year", "quarter", "month", "day"] as const;
export const disclosureDelays = [
	"6 weeks",
	"3 months",
	"12 months",
	"24 months",
] as const;
export const kpiClasses = [
	"income",
	"losses",
	"cash",
	"people",
	"activity",
	"personal",
] as const;
export const ruledClasses = [
	"income",
	"losses",
	"cash",
	"people",
	"activity",
] as const;
export const ruledAudiences = ["public", "member", "governance"] as const;
export const moneyPermissions = [
	"Invoices (write)",
	"Refunds (write)",
] as const;
/** At most this many live keys of the kind `pk` or `sk`. */
export const maxLiveKeysPerKind = 2;

const MAX_TEXT = 200;
const MAX_LIST = 200;
const MAX_CUTOFF_HOURS = 720;
const MAX_ROUNDING_UNIT = 100_000_000;
const MAX_DOLLAR_PROMO = 10_000_000;
const MAX_SESSION_PROMO = 10_000;
const MAX_PERCENT = 100;
const IDENTIFIER = /^[A-Za-z0-9_-]{1,40}$/;
const PROMO_CODE = /^[A-Za-z0-9-]{3,40}$/;
const CONTROL = /\p{Cc}/u;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

type Fields = Record<string, unknown>;

export class Collector {
	readonly problems: Problem[] = [];

	add(path: string, message: string, hint: string): void {
		this.problems.push({ path, message, hint });
	}
}

export const isRecord = (value: unknown): value is Fields =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const pathOf = (parent: string, key: string): string =>
	parent === "" ? key : `${parent}.${key}`;
const has = (record: Fields, key: string): boolean =>
	Object.hasOwn(record, key);

/** The object at `path`, or null after a problem; fields outside `allowed` are problems too. */
export const objectAt = (
	collector: Collector,
	value: unknown,
	path: string,
	allowed: readonly string[],
): Fields | null => {
	if (!isRecord(value)) {
		collector.add(
			path === "" ? "(value)" : path,
			"must be an object",
			"Send a JSON object.",
		);
		return null;
	}
	for (const key of Object.keys(value))
		if (!allowed.includes(key))
			collector.add(
				pathOf(path, key),
				`${key} is not a field of this object`,
				"Remove it.",
			);
	return value;
};

export const requireVersion = (collector: Collector, record: Fields): void => {
	if (record.schemaVersion !== SCHEMA_VERSION)
		collector.add(
			"schemaVersion",
			`must be ${SCHEMA_VERSION}`,
			`Set schemaVersion to ${SCHEMA_VERSION}.`,
		);
};

export const textAt = (
	collector: Collector,
	record: Fields,
	path: string,
	key: string,
	options: { max?: number; allowEmpty?: boolean } = {},
): string | null => {
	const at = pathOf(path, key);
	const value = record[key];
	if (!has(record, key) || typeof value !== "string") {
		collector.add(at, "must be text", "Give it a text value.");
		return null;
	}
	const max = options.max ?? MAX_TEXT;
	if (value.length > max) {
		collector.add(at, `is longer than ${max} characters`, "Shorten it.");
		return null;
	}
	if (CONTROL.test(value)) {
		collector.add(
			at,
			"has a control character",
			"Remove line breaks and other control characters.",
		);
		return null;
	}
	if (value.trim() === "" && options.allowEmpty !== true) {
		collector.add(at, "must not be empty", "Fill it in.");
		return null;
	}
	return value;
};

export const choiceAt = <Choice extends string>(
	collector: Collector,
	record: Fields,
	path: string,
	key: string,
	choices: readonly Choice[],
): Choice | null => {
	const value = record[key];
	if (
		typeof value === "string" &&
		(choices as readonly string[]).includes(value)
	)
		return value as Choice;
	collector.add(
		pathOf(path, key),
		`must be one of ${choices.join(", ")}`,
		`Pick ${choices.join(", ")}.`,
	);
	return null;
};

export const integerAt = (
	collector: Collector,
	record: Fields,
	path: string,
	key: string,
	range: { min: number; max: number },
): number | null => {
	const value = record[key];
	if (
		typeof value === "number" &&
		Number.isInteger(value) &&
		value >= range.min &&
		value <= range.max
	)
		return value;
	collector.add(
		pathOf(path, key),
		`must be a whole number from ${range.min} to ${range.max}`,
		`Use a whole number between ${range.min} and ${range.max}.`,
	);
	return null;
};

export const booleanAt = (
	collector: Collector,
	record: Fields,
	path: string,
	key: string,
): boolean | null => {
	const value = record[key];
	if (typeof value === "boolean") return value;
	collector.add(
		pathOf(path, key),
		"must be true or false",
		"Use true or false.",
	);
	return null;
};

export const dayAt = (
	collector: Collector,
	record: Fields,
	path: string,
	key: string,
): string | null => {
	const value = record[key];
	const match = typeof value === "string" ? DAY.exec(value) : null;
	if (match !== null) {
		const [, year, month, day] = match.map(Number) as [
			number,
			number,
			number,
			number,
		];
		const date = new Date(Date.UTC(year, month - 1, day));
		if (
			date.getUTCFullYear() === year &&
			date.getUTCMonth() === month - 1 &&
			date.getUTCDate() === day
		)
			return value as string;
	}
	collector.add(
		pathOf(path, key),
		"must be a day written YYYY-MM-DD",
		"Write it as 2026-12-31.",
	);
	return null;
};

export const identifierAt = (
	collector: Collector,
	record: Fields,
	path: string,
	key: string,
): string | null => {
	const value = record[key];
	if (typeof value === "string" && IDENTIFIER.test(value)) return value;
	collector.add(
		pathOf(path, key),
		"must be 1 to 40 letters, digits, dashes or underscores",
		"Use letters, digits, - or _.",
	);
	return null;
};

export const listAt = (
	collector: Collector,
	record: Fields,
	path: string,
	key: string,
	max = MAX_LIST,
): unknown[] | null => {
	const value = record[key];
	if (!Array.isArray(value)) {
		collector.add(pathOf(path, key), "must be a list", "Send a JSON list.");
		return null;
	}
	if (value.length > max) {
		collector.add(
			pathOf(path, key),
			`has more than ${max} entries`,
			"Remove some.",
		);
		return null;
	}
	return value;
};

/** Reports a repeat of an id seen before in the same list. */
export const uniqueIn = (
	collector: Collector,
	seen: Set<string>,
	id: string | null,
	path: string,
): void => {
	if (id === null) return;
	if (seen.has(id))
		collector.add(
			path,
			`${id} is used twice`,
			"Give each entry its own value.",
		);
	seen.add(id);
};

export const problemsOf = (
	collect: (collector: Collector) => void,
): Problem[] => {
	const collector = new Collector();
	collect(collector);
	return collector.problems;
};

export type Validator = (value: unknown, school: string) => Problem[];

export const limits = {
	MAX_CUTOFF_HOURS,
	MAX_ROUNDING_UNIT,
	MAX_DOLLAR_PROMO,
	MAX_SESSION_PROMO,
	MAX_PERCENT,
	PROMO_CODE,
};
