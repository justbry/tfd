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
import type { SubjectState } from "@autumn/balance-engine";
import { mutationToEvents } from "../ledger/postings.js";
import { balancesOf } from "../ledger/replay.js";
import { runOnState, toCatalog } from "../ledger/run.js";
import type {
	AdjustCreditsInput,
	AdjustCreditsRefusalReason,
	AdjustCreditsResult,
	AdjustKind,
	AdjustmentRecord,
	AtmEvent,
	AtmIdentity,
	BillingRow,
	GrantsState,
} from "../types.js";
import { MAX_GIFT_CREDITS } from "./codes.js";
import { resolveEnv } from "./env.js";
import { customerRow, giftEntId, type Op, rowOp } from "./grants.js";
import { commandOrg } from "./policy.js";
import {
	diffRows,
	GRANTS_TABLE,
	grantsFromRows,
	grantsRow,
	rowsFromState,
	stateFromRows,
	subjectKey,
} from "./rows.js";

export type { AdjustKind };

/** Why an admin changed a balance: `goodwill` and `gift` only add, a `correction` goes either way. */
export const ADJUST_KINDS = [
	"goodwill",
	"gift",
	"correction",
] as const satisfies readonly AdjustKind[];

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

/** The label an adjustment's events carry as their mapping: no Stripe event, no mapping file. */
const ADJUST_MAPPING = "atm/admin-adjust@v1";
/** The plan an adjustment's events name: `credits:issued:adjust` is never posted (an adjustment books `credits:adjust`). */
const ADJUST_PLAN = "adjust";

const refuse = (
	reason: AdjustCreditsRefusalReason,
	message: string,
): AdjustCreditsResult => ({ ok: false, reason, message });

const sameAdjustment = (
	earlier: AdjustmentRecord,
	input: AdjustCreditsInput,
): boolean =>
	earlier.kind === input.kind &&
	earlier.feature === input.featureId &&
	earlier.credits === input.credits;

const availableOf = (
	state: SubjectState | null,
	input: AdjustCreditsInput,
	holder: string,
): number => {
	if (!state) return 0;
	return (
		balancesOf({
			states: { [holder]: state as never },
			holds: {},
			catalog: toCatalog(input.catalog),
			asOfMs: input.now,
		}).find((balance) => balance.feature === input.featureId)?.avail ?? 0
	);
};

/** The credit rows a mutation moved: changed or new rows, and the rows whose rollovers it drew on. */
const movedRowIds = (
	changes: readonly { table: string; op: string; id?: string; row?: unknown }[],
	before: SubjectState | null,
): string[] => {
	const parentOf = new Map(
		(before?.rollovers ?? []).map((rollover) => [
			rollover.id,
			rollover.cus_ent_id,
		]),
	);
	const ids = new Set<string>();
	for (const change of changes) {
		const id = change.id ?? (change.row as { id?: string } | undefined)?.id;
		if (typeof id !== "string") continue;
		if (change.table === "customerEntitlements") ids.add(id);
		if (change.table === "rollovers") ids.add(parentOf.get(id) ?? id);
	}
	return [...ids].sort();
};

/**
 * An admin's change to a holder's balance of one feature, the tfd form of the family service's admin adjust. Pure: it
 * decides against the holder's rows and returns what to write.
 *
 * Checks, in order: a command id (`bad_command`); a known kind (`bad_kind`); whole credits, not 0, at most
 * `MAX_GIFT_CREDITS` either way, and positive for `goodwill` and `gift` (`bad_credits`); a replay (the grants state already
 * holds this command id) is ok with `replayed: true` and nothing to write when its kind, feature and credits match, else
 * `idempotency_conflict`; the menu has the feature (`unknown_feature`).
 *
 * Positive: a NEW credit row of `credits` (`adjustRowOp`: never refilled, never expiring, labelled `adjust:<kind>`), one
 * `applyBillingPlan` insert; a holder with no engine rows gets a customer in the same plan.
 *
 * Negative: one `updateBalance` that takes the credits from the feature's live rows, soonest expiry first (the engine's
 * `expiry` draw order whatever the policy says: the rollovers of earlier cycles first, then a refilling row by its next
 * reset and a one-off row by its expiry, a row that never lapses last). Never below zero: when the holder holds fewer
 * live credits than it takes, `insufficient_credits`.
 *
 * Either way the events are one `credit.adjusted` with `reason: <kind>`, labelled with the menu and policy versions and
 * the command id, and `GrantsState.adjusted[commandId]` records it. The command is `adjust:<commandId>:1`, so the caller's
 * command id must be unique in the school (the outbox keys events by school and idem).
 */
export const adjustCredits = (
	input: AdjustCreditsInput,
): AdjustCreditsResult => {
	const { commandId, kind, featureId, credits, now } = input;
	if (typeof commandId !== "string" || commandId === "")
		return refuse("bad_command", "an adjustment needs a command id");
	if (!isAdjustKind(kind))
		return refuse(
			"bad_kind",
			`the kind must be one of ${ADJUST_KINDS.join(", ")}`,
		);
	if (
		!Number.isSafeInteger(credits) ||
		credits === 0 ||
		Math.abs(credits) > MAX_GIFT_CREDITS
	)
		return refuse(
			"bad_credits",
			`credits must be a whole number from 1 to ${MAX_GIFT_CREDITS}, either way`,
		);
	if (credits < 0 && kind !== "correction")
		return refuse(
			"bad_credits",
			`a ${kind} adds credits; take them with a correction`,
		);

	const grants = grantsFromRows(input.rows);
	const earlier = grants.adjusted?.[commandId];
	if (earlier) {
		if (!sameAdjustment(earlier, input))
			return refuse(
				"idempotency_conflict",
				`command ${commandId} already adjusted ${earlier.credits} ${earlier.feature} (${earlier.kind})`,
			);
		return {
			ok: true,
			rowChanges: null,
			events: [],
			adjusted: earlier,
			replayed: true,
		};
	}
	if (!input.menu.features.some((feature) => feature.id === featureId))
		return refuse(
			"unknown_feature",
			`the menu has no feature ${JSON.stringify(featureId)}`,
		);

	const env = resolveEnv(input.env);
	const who = grants.identity ?? grants.holder ?? input.holder;
	const identity: AtmIdentity = {
		orgId: who.orgId,
		env,
		customerId: who.customerId,
		entityId: null,
	};
	const engineRows: BillingRow[] = input.rows.filter(
		(row) => row.table !== GRANTS_TABLE,
	);
	const hasEngineRows = engineRows.length > 0;
	// A subject whose only row so far is the grants row (a dollar gift came first) holds a later revision: its engine rows
	// are made at revision zero and the write is moved up to the stored revision, as `redeemSessionGiftCode` does.
	const engineRevision = hasEngineRows ? input.revision : 0;
	const before = stateFromRows({
		identity,
		revision: engineRevision,
		rows: input.rows,
	});
	if (credits < 0) {
		const available = availableOf(before, input, who.customerId);
		if (available < -credits)
			return refuse(
				"insufficient_credits",
				`the holder has ${available} ${featureId} to take ${-credits} from`,
			);
	}

	const engineCommandId = `adjust:${commandId}:1`;
	const base = {
		schemaVersion: 1,
		commandId: engineCommandId,
		requestId: engineCommandId,
		identity,
		occurredAt: now,
	};
	const command =
		credits > 0
			? {
					...base,
					type: "applyBillingPlan",
					org: commandOrg(input.policy),
					entityIds: [],
					expiringPooledBalanceIds: [],
					ops: [
						...(hasEngineRows
							? []
							: [
									{
										op: "insert",
										table: "customer",
										row: customerRow(who.customerId),
									},
								]),
						adjustRowOp({
							adjustmentId: commandId,
							kind,
							feature: featureId,
							customerId: who.customerId,
							credits,
							at: now,
						}),
					],
				}
			: {
					...base,
					type: "updateBalance",
					org: commandOrg({ ...input.policy, deductionOrder: "expiry" }),
					featureId,
					internalFeatureId: `feat_${featureId}`,
					addToBalance: credits,
				};
	const catalog = toCatalog(input.catalog);
	const run = runOnState({ state: before, catalog, command });
	const { mutation } = run;
	if (
		!mutation ||
		!run.state ||
		(mutation.result as { status?: string } | undefined)?.status === "rejected"
	)
		return refuse(
			credits > 0 ? "unknown_feature" : "insufficient_credits",
			`the engine could not adjust ${JSON.stringify(featureId)} by ${credits}`,
		);
	// The draw must have taken exactly what was asked: a shortfall the check above missed is refused, not written.
	if (
		credits < 0 &&
		availableOf(run.state, input, who.customerId) !==
			availableOf(before, input, who.customerId) + credits
	)
		return refuse(
			"insufficient_credits",
			`the engine could not take ${-credits} ${featureId} from live credits`,
		);

	const adjusted: AdjustmentRecord = {
		commandId,
		kind,
		feature: featureId,
		credits,
		at: now,
		rowIds: movedRowIds(mutation.changes as never, before),
	};
	const next: GrantsState = {
		...grants,
		identity: grants.identity ?? who,
		adjusted: { ...grants.adjusted, [commandId]: adjusted },
	};
	const labels = {
		menu_version: String(input.menuVersion),
		policy_version: String(input.policyVersion),
		mapping: ADJUST_MAPPING,
		// no stored input event caused this (an admin did), so no `cause`: the command id is the trace
		adjustment: commandId,
	};
	const events: AtmEvent[] = mutationToEvents({
		mutation,
		context: {
			school: who.orgId,
			tz: input.menu.timeZone,
			feature: featureId,
			plan: ADJUST_PLAN,
			as: "adjusted",
			reason: kind,
			labels,
			// the write logs every command it ran, so a replay may step over a revision gap in the log
			payload: { complete: true },
			before: before as never,
		},
	});

	const { upserts, deletes } = diffRows(engineRows, rowsFromState(run.state));
	// The subject's write is the engine's rows plus the grants row under one revision step.
	return {
		ok: true,
		rowChanges: {
			subjectKey: subjectKey(identity),
			expectedRevision: input.revision,
			nextRevision: mutation.revision.after + (input.revision - engineRevision),
			upserts: [...upserts, grantsRow(next)],
			deletes,
		},
		events,
		adjusted,
		replayed: false,
	};
};
