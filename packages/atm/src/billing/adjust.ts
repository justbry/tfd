/**
 * Admin credit adjustments: the row a positive adjustment writes, shared by `adjustCredits` and the importer (which takes
 * a caller's `adjust:<kind>` lots in as the same rows).
 *
 * The row: one credit row per adjustment and feature, id `ce_adjust_<length of adjustmentId>_<adjustmentId>_<feature>`,
 * on the feature's lifetime entitlement (`ent_gift_<feature>`, which `menuCatalogRows` makes for every feature), with no
 * reset (`next_reset_at` null: nothing refills it) and no expiry (`expires_at` null: decision 7, a positive admin
 * adjustment never expires). Its `external_id` is the label `adjust:<kind>`, so a reader can tell an adjustment and its
 * kind from the row alone.
 */
import { giftEntId, type Op, rowOp } from "./grants.js";

/** Why an admin changed a balance: `goodwill` and `gift` only add, a `correction` goes either way. */
export const ADJUST_KINDS = ["goodwill", "gift", "correction"] as const;
export type AdjustKind = (typeof ADJUST_KINDS)[number];

/** Every adjustment row's id starts with this. */
export const ADJUST_ROW_PREFIX = "ce_adjust_";

const LABEL_PREFIX = "adjust:";

export const isAdjustKind = (value: unknown): value is AdjustKind =>
	typeof value === "string" &&
	(ADJUST_KINDS as readonly string[]).includes(value);

/** The label an adjustment row carries (`external_id`), and the source a caller's lot of that kind has: `adjust:<kind>`. */
export const adjustLabel = (kind: AdjustKind): string =>
	`${LABEL_PREFIX}${kind}`;

/** The kind a label names, or null when it is no adjustment's label. */
export const adjustKindOfLabel = (
	label: string | null | undefined,
): AdjustKind | null => {
	if (typeof label !== "string" || !label.startsWith(LABEL_PREFIX)) return null;
	const kind = label.slice(LABEL_PREFIX.length);
	return isAdjustKind(kind) ? kind : null;
};

/**
 * The adjustment's credit row id. The id's length comes first so no two (adjustment, feature) pairs make the same row id:
 * ids and features may both hold `_`, so `a`+`b_c` and `a_b`+`c` would otherwise meet.
 */
export const adjustRowId = (adjustmentId: string, feature: string): string => {
	if (adjustmentId === "")
		throw new Error("an adjustment needs an id of its own");
	return `${ADJUST_ROW_PREFIX}${adjustmentId.length}_${adjustmentId}_${feature}`;
};

/**
 * The `applyBillingPlan` insert of a positive adjustment's row: `credits` of `feature`, never refilled, never expiring,
 * labelled `adjust:<kind>`, made at `at`. The importer passes the lot's id as `adjustmentId`, its balance as `credits` and
 * its creation time as `at`; `adjustCredits` passes its command id and the time it runs.
 */
export const adjustRowOp = ({
	adjustmentId,
	kind,
	feature,
	customerId,
	credits,
	at,
}: {
	adjustmentId: string;
	kind: AdjustKind;
	feature: string;
	customerId: string;
	credits: number;
	at: number;
}): Op => {
	const insert = rowOp({
		rowId: adjustRowId(adjustmentId, feature),
		cpId: null,
		entitlementId: giftEntId(feature),
		feature,
		customerId,
		balance: credits,
		nextResetAt: null,
		expiresAt: null,
		t: at,
	});
	return {
		...insert,
		row: {
			...(insert.row as Record<string, unknown>),
			external_id: adjustLabel(kind),
		},
	};
};
