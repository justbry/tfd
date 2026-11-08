/**
 * Admin credit adjustments (D12 T4): the shared `ce_adjust_` row a positive adjustment writes, which the importer also
 * writes for a caller's `adjust:<kind>` lots.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	ADJUST_KINDS,
	ADJUST_ROW_PREFIX,
	adjustKindOfLabel,
	adjustLabel,
	adjustRowId,
	adjustRowOp,
} from "../src/billing/adjust.js";
import { customerRow, menuCatalogRows } from "../src/billing/grants.js";
import { rowsFromState } from "../src/billing/rows.js";
import type { Menu } from "../src/billing/types.js";
import { balancesOf } from "../src/ledger/replay.js";
import { runOnState, toCatalog } from "../src/ledger/run.js";

const SCHOOL = "sch_vol";
const HOLDER = "family:fam_adjust";
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
