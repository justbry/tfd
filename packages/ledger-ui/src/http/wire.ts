import { schemaMismatch } from "./errors.ts";

/** Small readers for route answers (no schema library: protocol §3). Each throws `schema_mismatch` naming the route and
 * the field, so a shape change on the server is a typed failure, never a value the UI shows. */

export type WireRecord = Record<string, unknown>;

export const isRecord = (value: unknown): value is WireRecord =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export function recordOf(
	route: string,
	value: unknown,
	path: string,
): WireRecord {
	if (!isRecord(value)) throw schemaMismatch(route, `${path} is not an object`);
	return value;
}

export function arrayOf(
	route: string,
	value: unknown,
	path: string,
): unknown[] {
	if (!Array.isArray(value))
		throw schemaMismatch(route, `${path} is not a list`);
	return value;
}

export function stringOf(route: string, value: unknown, path: string): string {
	if (typeof value !== "string")
		throw schemaMismatch(route, `${path} is not a string`);
	return value;
}

export function numberOf(route: string, value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isFinite(value))
		throw schemaMismatch(route, `${path} is not a number`);
	return value;
}

export function booleanOf(
	route: string,
	value: unknown,
	path: string,
): boolean {
	if (typeof value !== "boolean")
		throw schemaMismatch(route, `${path} is not a boolean`);
	return value;
}

export function nullableStringOf(
	route: string,
	value: unknown,
	path: string,
): string | null {
	return value === null ? null : stringOf(route, value, path);
}

export function nullableNumberOf(
	route: string,
	value: unknown,
	path: string,
): number | null {
	return value === null ? null : numberOf(route, value, path);
}

export function oneOf<Value extends string>(
	route: string,
	value: unknown,
	path: string,
	allowed: readonly Value[],
): Value {
	if (
		typeof value !== "string" ||
		!(allowed as readonly string[]).includes(value)
	)
		throw schemaMismatch(
			route,
			`${path} is ${JSON.stringify(value)}, not one of ${allowed.join(", ")}`,
		);
	return value as Value;
}

/** The same value with object keys sorted at every depth: two requests are the same request when these are equal. */
export function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (isRecord(value))
		return `{${Object.keys(value)
			.filter((key) => value[key] !== undefined)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
			.join(",")}}`;
	return JSON.stringify(value) ?? "null";
}
