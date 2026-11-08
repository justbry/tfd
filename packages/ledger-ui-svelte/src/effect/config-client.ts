import { Context, type Effect } from "effect";
import type {
	ConfigName,
	ConfigValues,
	Problem,
} from "$worker-config/types.ts";
import type { UiError } from "./ui-error.ts";

/** The R2 config client (S9-plan sections 3 and 4, D18, D22): the school's config objects, read with an ETag, verified
 * (nothing is written) and put (a verified value, the base ETag, a fresh step-up). Its errors are `UiError`s, the Worker's
 * envelope already mapped (config-http.ts), so a screen shows them from the message table like any other failure. */

export type { ConfigName, ConfigValues, Problem };

/** One leaf a write would change, by path (`tiers[0].name`), as the Worker's `diffOf` words it. */
export type ConfigDiffEntry = {
	path: string;
	change: "added" | "removed" | "changed";
	before?: unknown;
	after?: unknown;
};

export type ConfigRead<Name extends ConfigName = ConfigName> = {
	value: ConfigValues[Name];
	/** The object's sha256 (the response's `ETag` without its quotes): the `baseEtag` of the next put. */
	etag: string;
	asOf: string | null;
	lagMinutes: number | null;
};

/** `POST .../verify`: the value was checked and nothing was written. `ok` goes with a `verifiedHash` (the sha256 of the
 * value's canonical JSON); a value with problems has none. `baseEtag` is the stored object's ETag, null when the object
 * does not exist yet. */
export type ConfigVerify = {
	ok: boolean;
	problems: readonly Problem[];
	diff: readonly ConfigDiffEntry[];
	verifiedHash: string | null;
	baseEtag: string | null;
};

/** `PUT`: `changed` is false when the stored object already held this value. */
export type ConfigPut = {
	name: ConfigName;
	sha256: string;
	bytes: number;
	changed: boolean;
};

export type ConfigApi = {
	readonly get: <Name extends ConfigName>(
		school: string,
		name: Name,
	) => Effect.Effect<ConfigRead<Name>, UiError>;
	readonly verify: <Name extends ConfigName>(
		school: string,
		name: Name,
		value: ConfigValues[Name],
	) => Effect.Effect<ConfigVerify, UiError>;
	/** `baseEtag` is the ETag read (If-Match); null for an object that does not exist yet (If-None-Match: *). */
	readonly put: <Name extends ConfigName>(
		school: string,
		name: Name,
		value: ConfigValues[Name],
		verifiedHash: string,
		baseEtag: string | null,
	) => Effect.Effect<ConfigPut, UiError>;
	/** Takes a new ledger token now, after the person confirmed with their PIN: the `su` claim (D22) is in the next one. */
	readonly refreshSession: () => Effect.Effect<void, UiError>;
};

export class ConfigClient extends Context.Service<ConfigClient, ConfigApi>()(
	"ledger-ui-svelte/ConfigClient",
) {}
