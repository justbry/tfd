/**
 * The `aud` of a ledger token: the short EdDSA JWT that `POST /school-admin/ledger-token` mints (buzz-school) and the
 * ledger Worker verifies on every read (`plans/ledger-ui/S8-contract.md`, section 2). The audience is `atm-ledger` and
 * moves to `tfd-ledger` (`plans/tfd-rename.md`, step 3). `isLedgerTokenAudience` is the check for the window, which
 * accepts both. The deployed ledger Worker (`packages/ledger-worker`) does not call it yet and still refuses anything
 * but `atm-ledger`, so a minter keeps issuing `LEGACY_LEDGER_TOKEN_AUDIENCE` until a Worker that calls it is deployed;
 * after buzz-school mints `tfd-ledger`, `atm-ledger` is dropped here. The claim must be exactly one of these strings:
 * an array, another string or a missing claim is refused. Pure: no Ajv, no disk, so it is in `tfd/worker`.
 */

/** The audience a ledger token moves to. Do not mint it until the deployed ledger Worker accepts it (see above). */
export const LEDGER_TOKEN_AUDIENCE = "tfd-ledger";
/** The audience buzz-school mints today, and the only one the deployed ledger Worker accepts. */
export const LEGACY_LEDGER_TOKEN_AUDIENCE = "atm-ledger";

/** Every audience `isLedgerTokenAudience` accepts during the window, the new one first. */
export const LEDGER_TOKEN_AUDIENCES = [
	LEDGER_TOKEN_AUDIENCE,
	LEGACY_LEDGER_TOKEN_AUDIENCE,
] as const;

export type LedgerTokenAudience = (typeof LEDGER_TOKEN_AUDIENCES)[number];

/** Whether a token's `aud` claim, as decoded, is one of `LEDGER_TOKEN_AUDIENCES`. */
export const isLedgerTokenAudience = (
	audience: unknown,
): audience is LedgerTokenAudience =>
	typeof audience === "string" &&
	(LEDGER_TOKEN_AUDIENCES as readonly string[]).includes(audience);
