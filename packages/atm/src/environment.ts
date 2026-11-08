/**
 * The one way this package reads an environment variable, for the rename window (`plans/tfd-rename.md`, step 3):
 * every variable is named `TFD_<name>` and read first by that name; when it is not set, the old name `ATM_<name>` is
 * read instead. An empty value counts as not set (an unset variable is sometimes exported as `NAME=`), so an empty
 * `TFD_<name>` falls back to `ATM_<name>`. The `ATM_*` names are read for one minor release after the one that adds
 * the `TFD_*` names (`UPGRADING.md`). Pure: it reads only the record it is given, never `process.env` itself, so it
 * is safe in a Worker.
 */

/** A variable's current name. Its old name is the same with `ATM_` in place of `TFD_`. */
export type EnvironmentVariableName = `TFD_${string}`;
/** The name a variable had before the rename. */
export type LegacyEnvironmentVariableName = `ATM_${string}`;

export type EnvironmentRecord = Readonly<Record<string, string | undefined>>;

const CURRENT_PREFIX = "TFD_";
const LEGACY_PREFIX = "ATM_";

/** `TFD_R2_BUCKET` -> `ATM_R2_BUCKET`. */
export const legacyEnvironmentVariableName = (
	name: EnvironmentVariableName,
): LegacyEnvironmentVariableName =>
	`${LEGACY_PREFIX}${name.slice(CURRENT_PREFIX.length)}`;

const present = (value: string | undefined): string | undefined =>
	value === undefined || value === "" ? undefined : value;

/** The value of `TFD_<name>`, else of `ATM_<name>`, else undefined; an empty value is not a value. */
export const readEnvironmentVariable = (
	environment: EnvironmentRecord,
	name: EnvironmentVariableName,
): string | undefined =>
	present(environment[name]) ??
	present(environment[legacyEnvironmentVariableName(name)]);
