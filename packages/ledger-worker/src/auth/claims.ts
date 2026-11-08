/** What the Worker takes from a verified token: the schools it lists, the step-up time and (for this request only) `sub`. */
import { ApiError } from "../http.js";
import type { Verified } from "./jwt.js";

export const audiences = [
	"public",
	"member",
	"governance",
	"finance",
	"owner",
] as const;
export type Audience = (typeof audiences)[number];

export type SchoolGrant = { role: string; finance: boolean };
export type Caller = {
	schools: ReadonlyMap<string, SchoolGrant>;
	/**
	 * The profile id (`sub`), kept for this request only: a config write hashes it into an opaque writer id, and nothing
	 * else reads it. Never stored, logged or returned as it is.
	 */
	subject: string | null;
	/** `su`: unix seconds of the last PIN step-up, when the family service sends it (S9 plan D22); null when absent. */
	stepUpAt: number | null;
};

const SCHOOL_ID = /^[0-9A-Za-z_-]+$/;

/** The schools of a verified token; a `schools` claim of another shape is an invalid token. */
export const callerOf = (verified: Extract<Verified, { ok: true }>): Caller => {
	const list = verified.claims.schools;
	if (!Array.isArray(list))
		throw new ApiError("token_invalid", "The token lists no schools.");
	const schools = new Map<string, SchoolGrant>();
	for (const entry of list as unknown[]) {
		if (typeof entry !== "object" || entry === null)
			throw new ApiError("token_invalid", "The token's schools are malformed.");
		const { id, role, finance } = entry as Record<string, unknown>;
		if (
			typeof id !== "string" ||
			!SCHOOL_ID.test(id) ||
			typeof role !== "string" ||
			typeof finance !== "boolean"
		)
			throw new ApiError("token_invalid", "The token's schools are malformed.");
		schools.set(id, { role, finance });
	}
	const { sub, su } = verified.claims;
	return {
		schools,
		subject: typeof sub === "string" && sub !== "" ? sub : null,
		// a `su` of another type is no step-up: the write is refused, the reads are not
		stepUpAt: typeof su === "number" && Number.isFinite(su) ? su : null,
	};
};

/** The finest audience this grant may be served (D7: an admin without the finance grant is `public`). */
export const maxAudienceOf = (grant: SchoolGrant): Audience =>
	grant.role === "owner" ? "owner" : grant.finance ? "finance" : "public";

export const audienceAllowed = (asked: Audience, grant: SchoolGrant): boolean =>
	audiences.indexOf(asked) <= audiences.indexOf(maxAudienceOf(grant));

export const isAudience = (value: string | null): value is Audience =>
	value !== null && (audiences as readonly string[]).includes(value);
