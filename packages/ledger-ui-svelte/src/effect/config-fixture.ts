import { Effect } from "effect";
import { bytesOf, canonicalJson, sha256Hex } from "$worker-config/canonical.ts";
import { definitions } from "$worker-config/definitions.ts";
import { diffOf } from "$worker-config/diff.ts";
import { CONFIG_NAMES, type Problem } from "$worker-config/types.ts";
import type {
	ConfigApi,
	ConfigName,
	ConfigRead,
	ConfigValues,
	ConfigVerify,
} from "./config-client.ts";
import { liftConfig } from "./config-lift.ts";
import { UiError, type UiErrorKind } from "./ui-error.ts";

/** The fixture ConfigClient: an in-memory store with the Worker's rules (packages/ledger-worker/src/routes/config.ts),
 * and the Worker's own validators, canonical JSON, hash and diff (imported read-only through `$worker-config`, so they
 * cannot drift). The order of checks is the route's: the gate (owner, finance, step-up), the body, the value (422),
 * the hash (422), the ETag (412), then the write. A test moves the clock of the step-up by `setStepUp`. */

export type FixtureGrant = { role: "owner" | "admin"; finance: boolean };

export type FixtureConfigOptions = {
	/** The person's grant on a school; null for a school the token does not name (the Worker answers 404). */
	grant: (school: string) => FixtureGrant | null | Promise<FixtureGrant | null>;
	/** Whether the token carries a fresh `su` claim (D22). Writes need it. Default: true. */
	stepUp?: boolean;
	asOf?: string | null;
};

export type FixtureConfig = ConfigApi & {
	/** Turns the fresh `su` claim on or off (a test of the 403 `step_up_required`). */
	setStepUp: (fresh: boolean) => void;
	/** Writes an object as someone else would, moving its ETag (a test of the 412). */
	writeBehind: (
		school: string,
		name: ConfigName,
		value: unknown,
	) => Promise<void>;
	/** The stored value and ETag, or null. */
	peek: (
		school: string,
		name: ConfigName,
	) => { value: unknown; etag: string } | null;
	/** Every call as `{ method, args }`, in order. */
	readonly calls: ReadonlyArray<{ method: string; args: unknown[] }>;
	/** How many times `refreshSession` ran. */
	readonly sessionRefreshes: () => number;
};

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** The kind and code each Worker refusal arrives as (config-http.ts maps the wire the same way). */
const refusal = (
	kind: UiErrorKind,
	status: number,
	code: string,
	message: string,
	extra: { field?: string; problems?: readonly Problem[] } = {},
): UiError =>
	new UiError({
		kind,
		detail: {
			status,
			code,
			...(extra.field ? { field: extra.field } : {}),
			...(extra.problems ? { problems: extra.problems } : {}),
		},
		reason: `${status} ${code}: ${message}`,
		retryable: false,
	});

const isName = (name: string): name is ConfigName =>
	(CONFIG_NAMES as readonly string[]).includes(name);

type Stored = { value: unknown; text: string; etag: string };

export function createFixtureConfig(
	options: FixtureConfigOptions,
): FixtureConfig {
	const store = new Map<string, Stored>();
	const calls: Array<{ method: string; args: unknown[] }> = [];
	let stepUp = options.stepUp ?? true;
	let refreshes = 0;
	const asOf = options.asOf ?? null;
	const keyOf = (school: string, name: string): string => `${school}/${name}`;

	const write = async (key: string, value: unknown): Promise<Stored> => {
		const text = canonicalJson(value);
		const stored = {
			// What a read serves is the stored text parsed back, as the Worker's is.
			value: JSON.parse(text) as unknown,
			text,
			etag: await sha256Hex(bytesOf(text)),
		};
		store.set(key, stored);
		return stored;
	};

	const nameOf = (name: string): ConfigName => {
		if (!isName(name))
			throw refusal("not_found", 404, "not_found", "No such config object.");
		return name;
	};
	const grantOn = async (school: string): Promise<FixtureGrant> => {
		const grant = await options.grant(school);
		if (grant === null)
			throw refusal("not_found", 404, "not_found", "No such school.");
		return grant;
	};
	const requireFinance = (name: ConfigName, grant: FixtureGrant): void => {
		if (definitions[name].moneyBearing && !grant.finance)
			throw refusal(
				"forbidden",
				403,
				"finance_required",
				"This needs the finance grant on the school.",
			);
	};
	const requireOwner = (grant: FixtureGrant): void => {
		if (grant.role !== "owner")
			throw refusal(
				"forbidden",
				403,
				"owner_only",
				"Only the school's owner can change this.",
			);
	};

	const record = (method: string, ...args: unknown[]): void => {
		calls.push({ method, args });
	};

	const get: ConfigApi["get"] = (school, name) => {
		record("get", school, name);
		return liftConfig(async () => {
			const known = nameOf(name);
			requireFinance(known, await grantOn(school));
			const stored = store.get(keyOf(school, known));
			if (!stored)
				throw refusal(
					"not_found",
					404,
					"not_found",
					`This school has no ${known} config yet.`,
				);
			const read: ConfigRead = {
				value: stored.value as ConfigValues[ConfigName],
				etag: stored.etag,
				asOf,
				lagMinutes: asOf === null ? null : 0,
			};
			return read as ConfigRead<typeof name>;
		});
	};

	const verify: ConfigApi["verify"] = (school, name, value) => {
		record("verify", school, name, value);
		return liftConfig(async (): Promise<ConfigVerify> => {
			const known = nameOf(name);
			const grant = await grantOn(school);
			requireOwner(grant);
			requireFinance(known, grant);
			const problems = definitions[known].validate(value, school);
			const stored = store.get(keyOf(school, known));
			const ok = problems.length === 0;
			return {
				ok,
				problems,
				diff: ok ? diffOf(stored ? stored.value : null, value) : [],
				verifiedHash: ok
					? await sha256Hex(bytesOf(canonicalJson(value)))
					: null,
				baseEtag: stored?.etag ?? null,
			};
		});
	};

	const put: ConfigApi["put"] = (
		school,
		name,
		value,
		verifiedHash,
		baseEtag,
	) => {
		record("put", school, name, value, verifiedHash, baseEtag);
		return liftConfig(async () => {
			const known = nameOf(name);
			const grant = await grantOn(school);
			requireOwner(grant);
			requireFinance(known, grant);
			if (!stepUp)
				throw refusal(
					"step_up",
					403,
					"step_up_required",
					"Confirm it is you with your PIN, then save again.",
				);
			const problems = definitions[known].validate(value, school);
			if (problems.length > 0)
				throw refusal(
					"bad_request",
					422,
					"invalid_config",
					"The value has problems.",
					{ problems },
				);
			const text = canonicalJson(value);
			const sha256 = await sha256Hex(bytesOf(text));
			if (!SHA256_HEX.test(verifiedHash))
				throw refusal(
					"bad_request",
					400,
					"bad_request",
					"The body needs the verifiedHash.",
					{ field: "verifiedHash" },
				);
			if (verifiedHash !== sha256)
				throw refusal(
					"bad_request",
					422,
					"invalid_config",
					"The value is not the one verified.",
					{
						problems: [
							{
								path: "verifiedHash",
								message: "is not the hash of this value",
								hint: "Verify the value again, then save what was verified.",
							},
						],
					},
				);
			const key = keyOf(school, known);
			const current = store.get(key);
			if (
				baseEtag === null ? current !== undefined : current?.etag !== baseEtag
			)
				throw refusal(
					"conflict",
					412,
					"stale_etag",
					"Someone changed this since you read it. Review their change, then save again.",
				);
			if (current?.etag === sha256)
				return {
					name: known,
					sha256,
					bytes: current.text.length,
					changed: false,
				};
			const stored = await write(key, value);
			return {
				name: known,
				sha256,
				bytes: bytesOf(stored.text).length,
				changed: true,
			};
		});
	};

	return {
		get,
		verify,
		put,
		refreshSession: () => {
			record("refreshSession");
			refreshes += 1;
			return Effect.void;
		},
		setStepUp: (fresh) => {
			stepUp = fresh;
		},
		writeBehind: async (school, name, value) => {
			await write(keyOf(school, name), value);
		},
		peek: (school, name) => {
			const stored = store.get(keyOf(school, name));
			return stored ? { value: stored.value, etag: stored.etag } : null;
		},
		calls,
		sessionRefreshes: () => refreshes,
	};
}
