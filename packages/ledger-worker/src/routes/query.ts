/** Reading a request's query: a field that is missing or malformed is a 400 that names it. */
import { ApiError } from "../http.js";
import { isDay } from "../time.js";

export const requiredText = (query: URLSearchParams, field: string): string => {
	const value = query.get(field);
	if (value === null || value === "")
		throw new ApiError("bad_request", `${field} is required.`, { field });
	return value;
};

export const oneOf = <Value extends string>(
	query: URLSearchParams,
	field: string,
	allowed: readonly Value[],
	required: boolean,
): Value | null => {
	const value = query.get(field);
	if (value === null || value === "") {
		if (required)
			throw new ApiError("bad_request", `${field} is required.`, { field });
		return null;
	}
	if (!(allowed as readonly string[]).includes(value))
		throw new ApiError(
			"bad_request",
			`${field} must be one of ${allowed.join(", ")}.`,
			{ field },
		);
	return value as Value;
};

/** `from` and `to` as school-local days, `from` not after `to`. */
export const dayRange = (
	query: URLSearchParams,
): { from: string; to: string } => {
	const from = requiredText(query, "from");
	const to = requiredText(query, "to");
	for (const [field, value] of [
		["from", from],
		["to", to],
	] as const)
		if (!isDay(value))
			throw new ApiError("bad_request", `${field} must be YYYY-MM-DD.`, {
				field,
			});
	if (from > to)
		throw new ApiError("bad_request", "from is after to.", { field: "from" });
	return { from, to };
};
