/**
 * The `aud` of a ledger token: the short EdDSA JWT that `POST /school-admin/ledger-token` mints (buzz-school) and the
 * ledger Worker verifies on every read (`plans/ledger-ui/S8-contract.md`, section 2). The audience was `atm-ledger`;
 * it is now `tfd-ledger`. During the rename window (`plans/tfd-rename.md`, step 3) the Worker accepts both, until
 * buzz-school mints the new one; then `atm-ledger` is dropped here. The claim must be exactly one of these strings: an
 * array, another string or a missing claim is refused. Pure: no Ajv, no disk, so it is in `atm/worker`.
 */

/** The audience a ledger token carries from now on. */
export const LEDGER_TOKEN_AUDIENCE = "tfd-ledger";
/** The audience buzz-school mints today, accepted until it mints `tfd-ledger`. */
export const LEGACY_LEDGER_TOKEN_AUDIENCE = "atm-ledger";

/** Every audience the ledger Worker accepts, the current one first. */
export const LEDGER_TOKEN_AUDIENCES = [
	LEDGER_TOKEN_AUDIENCE,
	LEGACY_LEDGER_TOKEN_AUDIENCE,
] as const;

export type LedgerTokenAudience = (typeof LEDGER_TOKEN_AUDIENCES)[number];

/** Whether a token's `aud` claim, as decoded, is one the ledger Worker accepts. */
export const isLedgerTokenAudience = (
	audience: unknown,
): audience is LedgerTokenAudience =>
	typeof audience === "string" &&
	(LEDGER_TOKEN_AUDIENCES as readonly string[]).includes(audience);
