/** The issue collector behind the hand-written validators: each check records a JSON path, a code and a message. */
import { parseDateTimeStamp } from "./datetime.js";

export type ValidationCode =
	| "required"
	| "type"
	| "format"
	| "value"
	| "context";

export type ValidationIssue = {
	path: string;
	code: ValidationCode;
	message: string;
};

export type Validation<T> =
	| { ok: true; value: T }
	| { ok: false; issues: ValidationIssue[] };

export type ContextOptions = {
	/** Context URLs allowed after the required ones. Default none: JCS signs bytes, not meaning, so an unvetted
	 * context could redefine what a signed term means to a JSON-LD reader. */
	extraContexts?: readonly string[];
};

export type JsonObject = Record<string, unknown>;

export const isRecord = (value: unknown): value is JsonObject =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export const URI = /^[a-zA-Z][a-zA-Z0-9+.-]*:\S+$/;
export const BASE10_INDEX = /^(0|[1-9]\d*)$/;
export const IDENTITY_HASH = /^(sha256|md5)\$[0-9a-fA-F]+$/;

export class Collector {
	readonly issues: ValidationIssue[] = [];

	add(path: string, code: ValidationCode, message: string): void {
		this.issues.push({ path, code, message });
	}

	record(value: unknown, path: string): JsonObject | null {
		if (value === undefined) {
			this.add(path, "required", "required");
			return null;
		}
		if (!isRecord(value)) {
			this.add(path, "type", "must be an object");
			return null;
		}
		return value;
	}

	string(
		value: unknown,
		path: string,
		options: { optional?: boolean } = {},
	): string | null {
		if (value === undefined) {
			if (!options.optional) this.add(path, "required", "required");
			return null;
		}
		if (typeof value !== "string" || value === "") {
			this.add(path, "type", "must be a non-empty string");
			return null;
		}
		return value;
	}

	uri(
		value: unknown,
		path: string,
		options: { optional?: boolean } = {},
	): void {
		const text = this.string(value, path, options);
		if (text !== null && !URI.test(text))
			this.add(path, "format", "must be a URI");
	}

	dateTime(
		value: unknown,
		path: string,
		options: { optional?: boolean } = {},
	): number | null {
		const text = this.string(value, path, options);
		if (text === null) return null;
		const instant = parseDateTimeStamp(text);
		if (instant === null)
			this.add(path, "format", "must be an XML Schema dateTimeStamp");
		return instant;
	}

	types(
		value: unknown,
		path: string,
		required: string[],
		oneOf: string[] = [],
	): void {
		if (value === undefined) {
			this.add(path, "required", "required");
			return;
		}
		const list = typeof value === "string" ? [value] : value;
		if (
			!Array.isArray(list) ||
			!list.every((item) => typeof item === "string")
		) {
			this.add(path, "type", "must be a string or an array of strings");
			return;
		}
		for (const name of required) {
			if (!list.includes(name)) this.add(path, "value", `must include ${name}`);
		}
		if (oneOf.length > 0 && !oneOf.some((name) => list.includes(name))) {
			this.add(path, "value", `must include one of ${oneOf.join(", ")}`);
		}
	}

	context(
		value: unknown,
		required: readonly string[],
		options: ContextOptions,
	): void {
		if (!Array.isArray(value)) {
			this.add(
				"@context",
				value === undefined ? "required" : "type",
				"must be an array",
			);
			return;
		}
		for (const [index, url] of required.entries()) {
			if (value[index] !== url)
				this.add(`@context[${index}]`, "context", `must be ${url}`);
		}
		const extra = new Set(options.extraContexts ?? []);
		for (let index = required.length; index < value.length; index++) {
			const entry = value[index];
			if (typeof entry !== "string") {
				this.add(
					`@context[${index}]`,
					"context",
					"inline contexts are not accepted",
				);
			} else if (!extra.has(entry)) {
				this.add(
					`@context[${index}]`,
					"context",
					`${entry} is not an accepted context`,
				);
			}
		}
	}
}

export const result = <T>(
	collector: Collector,
	value: unknown,
): Validation<T> =>
	collector.issues.length === 0
		? { ok: true, value: value as T }
		: { ok: false, issues: collector.issues };
