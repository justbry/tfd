/**
 * Admin credit adjustments (D12 T4): the shared `ce_adjust_` row a positive adjustment writes, which the importer also
 * writes for a caller's `adjust:<kind>` lots, and `adjustCredits`, the command that writes it or takes credits away.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	ADJUST_KINDS,
	ADJUST_ROW_PREFIX,
	adjustCredits,
	adjustKindOfLabel,
	adjustLabel,
	adjustRowId,
	adjustRowOp,
} from "../src/billing/adjust.js";
import {
	createSessionGiftCode,
	redeemSessionGiftCode,
} from "../src/billing/codes.js";
import { customerRow, menuCatalogRows } from "../src/billing/grants.js";
import { DEFAULT_POLICY } from "../src/billing/policy.js";
import {
	applyRowChanges,
	type BillingRow,
	grantsFromRows,
	rowsFromState,
	stateFromRows,
} from "../src/billing/rows.js";
import { lookupKeyOf, tierPriceKey } from "../src/billing/stripe-menu.js";
import type { Menu } from "../src/billing/types.js";
import { balancesOf, replayEvents } from "../src/ledger/replay.js";
import { runOnState, toCatalog } from "../src/ledger/run.js";
import { validateEvent } from "../src/ledger/validate.js";
import type { AdjustCreditsInput, AtmEvent } from "../src/types.js";
import { createStore } from "./billing-store.js";
import { invoicePaid } from "./stripe-events.js";

const SCHOOL = "sch_vol";
const FAMILY = "fam_adjust";
const HOLDER = `family:${FAMILY}`;
const DAY = 86_400_000;
const T0 = Date.parse("2026-01-15T18:00:00Z");
const menu = JSON.parse(
	readFileSync(
		`${import.meta.dir}/../fixtures/billing/grants/menu.json`,
		"utf8",
	),
) as Menu;
const catalogRows = menuCatalogRows({ menu, school: SCHOOL });
const catalog = toCatalog(catalogRows);
const identity = {
	orgId: SCHOOL,
	env: "live",
	customerId: HOLDER,
	entityId: null,
} as const;

describe("the adjustment row", () => {
	test("its id is prefixed, length-led and per feature", () => {
		expect(adjustRowId("adj_1", "visit")).toBe("ce_adjust_5_adj_1_visit");
		expect(adjustRowId("a", "b_c")).not.toBe(adjustRowId("a_b", "c"));
		expect(adjustRowId("lot_9", "visit").startsWith(ADJUST_ROW_PREFIX)).toBe(
			true,
		);
		expect(() => adjustRowId("", "visit")).toThrow();
	});

	test("its label names the kind, and only a known kind reads back", () => {
		for (const kind of ADJUST_KINDS) {
			expect(adjustLabel(kind)).toBe(`adjust:${kind}`);
			expect(adjustKindOfLabel(adjustLabel(kind))).toBe(kind);
		}
		expect(adjustKindOfLabel("adjust:rollback")).toBeNull();
		expect(adjustKindOfLabel("tier")).toBeNull();
		expect(adjustKindOfLabel(null)).toBeNull();
	});

	test("the insert: the feature's lifetime entitlement, no reset, no expiry, labelled", () => {
		const op = adjustRowOp({
			adjustmentId: "adj_1",
			kind: "goodwill",
			feature: "visit",
			customerId: HOLDER,
			credits: 3,
			at: T0,
		});
		expect(op).toMatchObject({
			op: "insert",
			table: "customerEntitlements",
			row: {
				id: "ce_adjust_5_adj_1_visit",
				customer_product_id: null,
				entitlement_id: "ent_gift_visit",
				balance: 3,
				next_reset_at: null,
				expires_at: null,
				external_id: "adjust:goodwill",
				created_at: T0,
			},
		});
	});

	test("the engine takes it, keeps the label and counts it for good", () => {
		const command = {
			schemaVersion: 1,
			type: "applyBillingPlan",
			org: { config: {} },
			commandId: "adjust:shape:1",
			requestId: "adjust:shape:1",
			identity,
			occurredAt: T0,
			entityIds: [],
			expiringPooledBalanceIds: [],
			ops: [
				{ op: "insert", table: "customer", row: customerRow(HOLDER) },
				adjustRowOp({
					adjustmentId: "adj_1",
					kind: "correction",
					feature: "visit",
					customerId: HOLDER,
					credits: 4,
					at: T0,
				}),
			],
		};
		const run = runOnState({ state: null, catalog, command });
		if (!run.mutation || !run.state) throw new Error("decided nothing");
		const row = rowsFromState(run.state).find(
			(r) => r.id === "ce_adjust_5_adj_1_visit",
		);
		expect(row?.data.external_id).toBe("adjust:correction");
		const avail = (asOfMs: number) =>
			balancesOf({
				states: { [HOLDER]: run.state as never },
				holds: {},
				catalog,
				asOfMs,
			}).find((b) => b.feature === "visit")?.avail;
		expect(avail(T0 + DAY)).toBe(4);
		expect(avail(T0 + 3650 * DAY)).toBe(4);
	});
});

/** A holder's rows as the caller stores them, with the events its log holds. */
type Held = { rows: BillingRow[]; revision: number; events: AtmEvent[] };

const NOW = T0 + 10 * DAY;
const fresh = (): Held => ({ rows: [], revision: 0, events: [] });

const adjust = (
	held: Held,
	change: Partial<AdjustCreditsInput> = {},
): ReturnType<typeof adjustCredits> =>
	adjustCredits({
		commandId: "adm_1",
		kind: "goodwill",
		featureId: "visit",
		credits: 3,
		holder: { orgId: SCHOOL, customerId: HOLDER },
		menu,
		menuVersion: 4,
		policy: DEFAULT_POLICY,
		policyVersion: 2,
		rows: held.rows,
		revision: held.revision,
		catalog: catalogRows,
		now: NOW,
		...change,
	});

/** Adjusts and writes: the rows move on and the events join the log. */
const adjusted = (held: Held, change: Partial<AdjustCreditsInput> = {}) => {
	const result = adjust(held, change);
	if (!result.ok) throw new Error(`${result.reason}: ${result.message}`);
	if (!result.rowChanges) return { held, result };
	const next = applyRowChanges({
		rows: held.rows,
		revision: held.revision,
		changes: result.rowChanges,
	});
	return {
		held: { ...next, events: [...held.events, ...result.events] },
		result,
	};
};

const availOf = (held: Held, asOfMs: number, feature = "visit") => {
	const state = stateFromRows({
		identity,
		revision: held.revision,
		rows: held.rows,
	});
	if (!state) return 0;
	return (
		balancesOf({
			states: { [HOLDER]: state as never },
			holds: {},
			catalog,
			asOfMs,
		}).find((b) => b.feature === feature)?.avail ?? 0
	);
};

const rowBalance = (held: Held, id: string) =>
	held.rows.find((r) => r.table === "customerEntitlements" && r.id === id)?.data
		.balance;

const TIER_ROW = "ce_tier_visit_month";
const PERIOD_END = T0 + 30 * DAY;

/** A family on sparkle-2 (2 visits a month, refilled at the period end) with a session gift code of 5 (lapsing in 6 months). */
const member = (): Held => {
	const store = createStore({ menu, school: SCHOOL, family: FAMILY });
	store.handle(
		invoicePaid({
			eventId: "evt_create",
			invoiceId: "in_1",
			at: T0 + 5000,
			subscriptionId: "sub_1",
			reason: "subscription_create",
			periodStart: T0,
			periodEnd: PERIOD_END,
			lines: [
				{
					lookupKey: lookupKeyOf(
						SCHOOL,
						tierPriceKey("sparkle-2", "month"),
						26000,
						"usd",
					),
					amount: 26000,
					interval: "month",
				},
			],
			metadata: { b4u_school: SCHOOL, family_id: FAMILY },
		}),
		T0 + 5000,
	);
	const code = createSessionGiftCode({
		id: "code_1",
		code: "VISIT-FOR-YOU",
		featureId: "visit",
		credits: 5,
		redeemBy: T0 + 90 * DAY,
		createdAt: T0,
		menu,
		policy: DEFAULT_POLICY,
	});
	if (!code.ok) throw new Error(code.message);
	const redeemed = redeemSessionGiftCode({
		code: code.code,
		entered: "VISIT-FOR-YOU",
		holder: { orgId: SCHOOL, customerId: HOLDER },
		menu,
		menuVersion: 4,
		policy: DEFAULT_POLICY,
		policyVersion: 2,
		rows: store.rows,
		revision: store.revision,
		catalog: catalogRows,
		now: T0 + DAY,
	});
	if (!redeemed.ok || !redeemed.rowChanges) throw new Error("not redeemed");
	const next = applyRowChanges({
		rows: store.rows,
		revision: store.revision,
		changes: redeemed.rowChanges,
	});
	return { ...next, events: [...store.events, ...redeemed.events] };
};

const GIFT_ROW = "ce_gift_code_6_code_1_visit";

describe("adjustCredits: positive", () => {
	test("a new family: a customer and a ce_adjust_ row that never expires, and one credit.adjusted", () => {
		const { held, result } = adjusted(fresh());
		if (!result.ok) throw new Error("refused");
		expect(result.replayed).toBe(false);
		expect(result.rowChanges).toMatchObject({
			subjectKey: `${SCHOOL}|live|${HOLDER}`,
			expectedRevision: 0,
			nextRevision: 1,
			deletes: [],
		});
		const row = held.rows.find((r) => r.id === "ce_adjust_5_adm_1_visit");
		expect(row?.data).toMatchObject({
			entitlement_id: "ent_gift_visit",
			balance: 3,
			next_reset_at: null,
			expires_at: null,
			external_id: "adjust:goodwill",
		});
		expect(availOf(held, NOW + DAY)).toBe(3);
		expect(availOf(held, NOW + 3650 * DAY)).toBe(3);
		expect(result.adjusted).toEqual({
			commandId: "adm_1",
			kind: "goodwill",
			feature: "visit",
			credits: 3,
			at: NOW,
			rowIds: ["ce_adjust_5_adm_1_visit"],
		});
		expect(grantsFromRows(held.rows).adjusted?.adm_1).toEqual(result.adjusted);
		expect(result.events.map((e) => e.event_type)).toEqual(["credit.adjusted"]);
		const [event] = result.events;
		expect(event?.payload).toMatchObject({ reason: "goodwill" });
		expect(event?.labels).toMatchObject({
			feature: "visit",
			plan: "adjust",
			menu_version: "4",
			policy_version: "2",
			mapping: "atm/admin-adjust@v1",
			adjustment: "adm_1",
		});
		expect(event?.postings.map((p) => [p.account, p.amount])).toEqual([
			[`credits:avail:${HOLDER}:visit`, "3"],
			["credits:adjust", "-3"],
		]);
		for (const e of result.events)
			expect(validateEvent(e).errors, e.idem).toEqual([]);
	});

	test("a member: a new row beside the tier's and the gift's; nothing existing moves", () => {
		const start = member();
		const { held, result } = adjusted(start, { credits: 4, kind: "gift" });
		if (!result.ok || !result.rowChanges) throw new Error("refused");
		expect(result.rowChanges.deletes).toEqual([]);
		expect(
			result.rowChanges.upserts.map((r) => `${r.table}:${r.id}`).sort(),
		).toEqual([
			"atm_grants:grants",
			"customerEntitlements:ce_adjust_5_adm_1_visit",
		]);
		expect(availOf(held, NOW)).toBe(availOf(start, NOW) + 4);
		expect(rowBalance(held, "ce_adjust_5_adm_1_visit")).toBe(4);
	});

	test("every kind may add; the label is the kind", () => {
		for (const kind of ADJUST_KINDS) {
			const { held, result } = adjusted(fresh(), { kind });
			if (!result.ok) throw new Error("refused");
			expect(
				held.rows.find((r) => r.id === "ce_adjust_5_adm_1_visit")?.data
					.external_id,
			).toBe(`adjust:${kind}`);
			expect(result.events[0]?.payload).toMatchObject({ reason: kind });
		}
	});
});

describe("adjustCredits: negative", () => {
	test("a correction takes from the soonest to lapse first: the tier's row, then the gift; a never-expiring row last", () => {
		const { held: plus } = adjusted(member(), {
			commandId: "adm_plus",
			credits: 3,
		});
		expect(rowBalance(plus, TIER_ROW)).toBe(2);
		expect(rowBalance(plus, GIFT_ROW)).toBe(5);
		const before = availOf(plus, NOW);
		expect(before).toBe(10);
		const { held, result } = adjusted(plus, {
			commandId: "adm_minus",
			kind: "correction",
			credits: -4,
		});
		if (!result.ok) throw new Error("refused");
		expect(availOf(held, NOW)).toBe(6);
		expect(rowBalance(held, TIER_ROW)).toBe(0);
		expect(rowBalance(held, GIFT_ROW)).toBe(3);
		expect(rowBalance(held, "ce_adjust_8_adm_plus_visit")).toBe(3);
		expect(result.adjusted.rowIds).toEqual([GIFT_ROW, TIER_ROW]);
		expect(result.events.map((e) => e.event_type)).toEqual(["credit.adjusted"]);
		expect(result.events[0]?.payload).toMatchObject({ reason: "correction" });
		expect(
			result.events[0]?.postings.map((p) => [p.account, p.amount]),
		).toEqual([
			[`credits:avail:${HOLDER}:visit`, "-4"],
			["credits:adjust", "4"],
		]);
		for (const e of result.events)
			expect(validateEvent(e).errors, e.idem).toEqual([]);
	});

	test("it may take everything, down to zero and no further", () => {
		const start = member();
		const { held } = adjusted(start, {
			kind: "correction",
			credits: -availOf(start, NOW),
		});
		expect(availOf(held, NOW)).toBe(0);
		for (const row of held.rows)
			if (row.table === "customerEntitlements")
				expect(row.data.balance as number).toBeGreaterThanOrEqual(0);
	});

	test("too few live credits: insufficient_credits and nothing written", () => {
		const start = member();
		expect(
			adjust(start, {
				kind: "correction",
				credits: -(availOf(start, NOW) + 1),
			}),
		).toMatchObject({ ok: false, reason: "insufficient_credits" });
		// a family with no rows holds nothing
		expect(adjust(fresh(), { kind: "correction", credits: -1 })).toMatchObject({
			ok: false,
			reason: "insufficient_credits",
		});
		// a lapsed gift does not count: 7 months on, only the refilling row is left to take from
		const late = T0 + 210 * DAY;
		expect(
			adjust(start, { kind: "correction", credits: -3, now: late }),
		).toMatchObject({ ok: false, reason: "insufficient_credits" });
	});

	test("goodwill and gifts only add", () => {
		for (const kind of ["goodwill", "gift"] as const)
			expect(adjust(member(), { kind, credits: -1 })).toMatchObject({
				ok: false,
				reason: "bad_credits",
			});
	});
});

describe("adjustCredits: refusals and idempotency", () => {
	test("each bad input has its own reason", () => {
		const reason = (change: Partial<AdjustCreditsInput>) => {
			const result = adjust(fresh(), change);
			return result.ok ? "ok" : result.reason;
		};
		expect(reason({ commandId: "" })).toBe("bad_command");
		expect(reason({ kind: "rollback" as never })).toBe("bad_kind");
		expect(reason({ credits: 0 })).toBe("bad_credits");
		expect(reason({ credits: 1.5 })).toBe("bad_credits");
		expect(reason({ credits: 100_001 })).toBe("bad_credits");
		expect(reason({ featureId: "nope" })).toBe("unknown_feature");
		expect(reason({})).toBe("ok");
	});

	test("the same command id with the same fields is a replay: ok, nothing to write; other fields conflict", () => {
		const { held, result } = adjusted(member());
		if (!result.ok) throw new Error("refused");
		const again = adjust(held);
		expect(again).toEqual({
			ok: true,
			rowChanges: null,
			events: [],
			adjusted: result.adjusted,
			replayed: true,
		});
		expect(adjust(held, { credits: 4 })).toMatchObject({
			ok: false,
			reason: "idempotency_conflict",
		});
		expect(adjust(held, { kind: "gift" })).toMatchObject({
			ok: false,
			reason: "idempotency_conflict",
		});
		// a later command id is a new adjustment
		expect(adjust(held, { commandId: "adm_2" })).toMatchObject({
			ok: true,
			replayed: false,
		});
	});

	test("the same inputs give the same result: no clock, no randomness", () => {
		expect(JSON.stringify(adjust(member()))).toBe(
			JSON.stringify(adjust(member())),
		);
	});
});

describe("adjustCredits: the log replays", () => {
	test("a member's log with adjustments both ways replays to the same rows and balances", () => {
		let held = member();
		held = adjusted(held, { commandId: "adm_a", credits: 3 }).held;
		held = adjusted(held, {
			commandId: "adm_b",
			kind: "correction",
			credits: -4,
			now: NOW + DAY,
		}).held;
		held = adjusted(held, {
			commandId: "adm_c",
			kind: "correction",
			credits: 2,
			now: NOW + 2 * DAY,
		}).held;
		const asOf = NOW + 3 * DAY;
		const replayed = replayEvents({
			events: held.events,
			catalog: catalogRows,
			asOf: new Date(asOf).toISOString(),
		});
		expect(replayed.applied).toBe(held.events.length);
		const state = replayed.snapshot.states[HOLDER];
		expect(state).toBeDefined();
		const engineRows = held.rows.filter((r) => r.table !== "atm_grants");
		expect(rowsFromState(state as never)).toEqual(engineRows);
		expect(replayed.balances.find((b) => b.feature === "visit")?.avail).toBe(
			availOf(held, asOf),
		);
	});

	test("a new family's first adjustment starts its log", () => {
		const { held } = adjusted(fresh());
		const replayed = replayEvents({
			events: held.events,
			catalog: catalogRows,
		});
		expect(replayed.applied).toBe(1);
		expect(rowsFromState(replayed.snapshot.states[HOLDER] as never)).toEqual(
			held.rows.filter((r) => r.table !== "atm_grants"),
		);
	});
});
