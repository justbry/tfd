/**
 * Where `atm inputs ship` puts the objects: a folder (`--root`) or an R2 bucket (`--r2-bucket`, `--r2-endpoint`,
 * `--r2-prefix`). Precedence, highest first: the flags; the environment variables for the same non-secret values
 * (`TFD_R2_ENDPOINT`, `TFD_R2_BUCKET`, `TFD_R2_PREFIX`), used only when `--root` is not given; nothing, which is an error. The
 * credentials come from the environment only (`TFD_R2_ACCESS_KEY_ID`, `TFD_R2_SECRET_ACCESS_KEY`, optional
 * `TFD_R2_SESSION_TOKEN`), never from a flag: a flag shows in the process list. Each variable is also read by its old
 * name (`ATM_R2_*`) when the `TFD_R2_*` one is not set (`../environment.ts`). Pure: it reads nothing but its arguments.
 */
import { readEnvironmentVariable } from "../environment.js";
import type { R2StoreOptions } from "../types.js";

export type InputsDestinationFlags = {
	root?: string;
	r2Bucket?: string;
	r2Endpoint?: string;
	r2Prefix?: string;
};

export type InputsDestination =
	| { kind: "folder"; root: string }
	| { kind: "r2"; options: R2StoreOptions };

/** A refusal whose message is already the one line for the operator. */
export class InputsDestinationError extends Error {}

/** The variables, by their current names; `readEnvironmentVariable` falls back to the `ATM_R2_*` names. */
export const R2_ENV = {
	endpoint: "TFD_R2_ENDPOINT",
	bucket: "TFD_R2_BUCKET",
	prefix: "TFD_R2_PREFIX",
	accessKeyId: "TFD_R2_ACCESS_KEY_ID",
	secretAccessKey: "TFD_R2_SECRET_ACCESS_KEY",
	sessionToken: "TFD_R2_SESSION_TOKEN",
} as const;

/** What a refusal adds after the names it asks for. */
export const LEGACY_R2_ENV_NOTE = "the ATM_R2_* names still work";

const HTTP_URL = /^https?:\/\/[^\s/]+/;

/** A flag value that is there: an empty string is not. */
const present = (value: string | undefined): string | undefined =>
	value === undefined || value === "" ? undefined : value;

export const resolveInputsDestination = (
	flags: InputsDestinationFlags,
	env: Readonly<Record<string, string | undefined>>,
): InputsDestination => {
	const r2Flags = [flags.r2Bucket, flags.r2Endpoint, flags.r2Prefix].some(
		(value) => value !== undefined,
	);
	if (flags.root !== undefined) {
		if (r2Flags)
			throw new InputsDestinationError(
				"give --root, or --r2-bucket with --r2-endpoint, not both",
			);
		return { kind: "folder", root: flags.root };
	}
	const bucket =
		present(flags.r2Bucket) ?? readEnvironmentVariable(env, R2_ENV.bucket);
	if (bucket === undefined)
		throw new InputsDestinationError(
			`give --root <folder>, or --r2-bucket <name> with --r2-endpoint <url> (or ${R2_ENV.bucket} and ${R2_ENV.endpoint} in the environment; ${LEGACY_R2_ENV_NOTE})`,
		);
	const endpoint =
		present(flags.r2Endpoint) ?? readEnvironmentVariable(env, R2_ENV.endpoint);
	if (endpoint === undefined)
		throw new InputsDestinationError(
			`--r2-bucket needs --r2-endpoint <url> (or ${R2_ENV.endpoint} in the environment; ${LEGACY_R2_ENV_NOTE})`,
		);
	if (!HTTP_URL.test(endpoint))
		throw new InputsDestinationError(
			"--r2-endpoint must be an http:// or https:// URL",
		);
	const accessKeyId = readEnvironmentVariable(env, R2_ENV.accessKeyId);
	const secretAccessKey = readEnvironmentVariable(env, R2_ENV.secretAccessKey);
	const missing = [
		accessKeyId === undefined ? R2_ENV.accessKeyId : null,
		secretAccessKey === undefined ? R2_ENV.secretAccessKey : null,
	].filter((name) => name !== null);
	if (accessKeyId === undefined || secretAccessKey === undefined)
		throw new InputsDestinationError(
			`R2 credentials come from the environment only; set ${missing.join(" and ")} (${LEGACY_R2_ENV_NOTE}; there is no flag for them)`,
		);
	const prefix =
		present(flags.r2Prefix) ?? readEnvironmentVariable(env, R2_ENV.prefix);
	const sessionToken = readEnvironmentVariable(env, R2_ENV.sessionToken);
	return {
		kind: "r2",
		options: {
			endpoint,
			bucket,
			accessKeyId,
			secretAccessKey,
			...(prefix === undefined ? {} : { prefix }),
			...(sessionToken === undefined ? {} : { sessionToken }),
		},
	};
};
