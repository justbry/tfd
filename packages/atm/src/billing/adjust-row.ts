/**
 * The credit row an admin adjustment holds: a positive adjustment is credits that never refill and never lapse (owner
 * decision D12-7), so it is its own row, apart from the refilling rows a cycle resets.
 *
 * TODO(track B): `adjustCredits` (D12 T4) owns this shape. Until it lands, the importer writes the same row here: id prefix
 * `ce_adjust_`, the feature's lifetime entitlement (no reset interval), no `next_reset_at`, `expires_at` null, and
 * `external_id` carrying `adjust:<kind>`. When T4 merges, take its helper and delete this file.
 */
import { giftEntId, rowOp } from "./grants.js";

export const ADJUST_ROW_PREFIX = "ce_adjust_";
const ADJUST_SOURCE_PREFIX = "adjust:";

/** `adjust:<kind>` (the caller's lot source) to its kind, or null for any other source. */
export const adjustKindOf = (source: string): string | null =>
	source.startsWith(ADJUST_SOURCE_PREFIX) &&
	source.length > ADJUST_SOURCE_PREFIX.length
		? source.slice(ADJUST_SOURCE_PREFIX.length)
		: null;

/** The row id of one adjustment of one feature; `key` is the adjustment's own id (its idempotency key). */
export const adjustRowId = (key: string, feature: string): string =>
	`${ADJUST_ROW_PREFIX}${key.length}_${key}_${feature}`;

/** The engine row of an adjustment of `balance` credits of `feature`, made at `t`. */
export const adjustmentRow = ({
	key,
	kind,
	feature,
	customerId,
	balance,
	t,
}: {
	key: string;
	kind: string;
	feature: string;
	customerId: string;
	balance: number;
	t: number;
}): Record<string, unknown> => {
	const row = rowOp({
		rowId: adjustRowId(key, feature),
		cpId: null,
		entitlementId: giftEntId(feature),
		feature,
		customerId,
		balance,
		nextResetAt: null,
		expiresAt: null,
		t,
	}).row as Record<string, unknown>;
	row.external_id = `${ADJUST_SOURCE_PREFIX}${kind}`;
	return row;
};
