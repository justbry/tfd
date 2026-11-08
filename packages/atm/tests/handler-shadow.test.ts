/**
 * The compare-only shadow's diff (D12 T7): the shadow's balances against the caller's sums, each difference tagged with
 * the reason that excuses it, or `unexplained`. One test per reason.
 */
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { customerRow, menuCatalogRows, rowOp } from "../src/billing/grants.js";
import { rowsFromState } from "../src/billing/rows.js";
import type { Menu } from "../src/billing/types.js";
import { bunSqlite } from "../src/handler/bun-sqlite.js";
import { HANDLER_DDL } from "../src/handler/schema.js";
import { diffBalances } from "../src/handler/shadow.js";
import { runOnState, toCatalog } from "../src/ledger/run.js";
import { invoicePaid } from "../src/scenario/stripe-events.js";
import type {
	CallerCreditLotRow,
	DiffBalancesInput,
	ShadowMember,
	SqlDatabase,
} from "../src/types.js";
import {
	FAMILY,
	GROSS,
	HOUR,
	harness,
	menu,
	paid,
	SCHOOL,
	T0,
	T1,
	tierKey,
} from "./handler-harness.js";

const HOLDER = `family:${FAMILY}`;
const DAY = 24 * HOUR;
const T2 = Date.parse("2026-03-15T18:00:00Z");
const catalog = menuCatalogRows({ menu, school: SCHOOL });

const lot = (over: Partial<CallerCreditLotRow>): CallerCreditLotRow => ({
	id: "lot_1",
	membership_id: "mem_1",
	school_id: SCHOOL,
	feature_id: "visit",
	invoice_id: "in_1",
	source: "tier",
	every: "month",
	allowance: 2,
	removed_at: null,
	balance: 2,
	adjustment: 0,
	additional_balance: 0,
	next_reset_at: null,
	expires_at: T1,
	created_at: T0,
	...over,
});

const diff = (
	db: SqlDatabase,
	member: Omit<ShadowMember, "customerId">,
	over: Partial<DiffBalancesInput> = {},
) =>
	diffBalances({
		db,
		school: SCHOOL,
		catalog,
		now: T0 + DAY,
		importedAt: T0 + HOUR,
		members: [{ customerId: HOLDER, ...member }],
		...over,
	});

/** A shadow whose member is on sparkle-2 since in_1 (2 visits, refilled at T1). */
const member = (served: Menu = menu) => {
	const h = harness(undefined, { menu: served });
	expect(h.deliver(paid("in_1")).status).toBe(200);
	return h;
};

/** A shadow holding the rows a plan of `ops` makes for the member, written as the handler writes them. */
const shadowOf = (ops: Record<string, unknown>[]): SqlDatabase => {
	const identity = {
		orgId: SCHOOL,
		env: "live",
		customerId: HOLDER,
		entityId: null,
	} as const;
	const run = runOnState({
		state: null,
		catalog: toCatalog(catalog),
		command: {
			schemaVersion: 1,
			type: "applyBillingPlan",
			org: { config: {} },
			commandId: "shadow:1",
			requestId: "shadow:1",
			identity,
			occurredAt: T0,
			entityIds: [],
			expiringPooledBalanceIds: [],
			ops: [
				{ op: "insert", table: "customer", row: customerRow(HOLDER) },
				...ops,
			],
		},
	});
	if (!run.state) throw new Error("no state");
	const db = bunSqlite(new Database(":memory:"));
	db.exec(HANDLER_DDL);
	const key = `${SCHOOL}|live|${HOLDER}`;
	db.run(`INSERT INTO atm_subjects (subject_key, revision) VALUES (?, 1)`, [
		key,
	]);
	for (const row of rowsFromState(run.state))
		db.run(
			`INSERT INTO atm_rows (subject_key, table_name, row_id, data) VALUES (?, ?, ?, ?)`,
			[key, row.table, row.id, JSON.stringify(row.data)],
		);
	return db;
};

const oneOff = (rowId: string, balance: number, expiresAt: number | null) =>
	rowOp({
		rowId,
		cpId: null,
		entitlementId: "ent_gift_visit",
		feature: "visit",
		customerId: HOLDER,
		balance,
		nextResetAt: null,
		expiresAt,
		t: T0,
	});

describe("diffBalances", () => {
	test("equal balances: no difference", () => {
		expect(diff(member().db, { balances: { visit: 2 } })).toEqual([]);
	});

	test("unexplained: nothing either side holds accounts for it", () => {
		expect(diff(member().db, { balances: { visit: 5 }, lots: [] })).toEqual([
			{
				customerId: HOLDER,
				feature: "visit",
				callerBalance: 5,
				tfdBalance: 2,
				delta: -3,
				reason: "unexplained",
				adjustedSinceImport: 0,
			},
		]);
		// a feature only the caller holds, and a member the shadow has no rows for, are differences too
		expect(
			diffBalances({
				db: member().db,
				school: SCHOOL,
				catalog,
				now: T0 + DAY,
				importedAt: T0 + HOUR,
				members: [{ customerId: "family:nobody", balances: { retreat: 1 } }],
			}),
		).toMatchObject([
			{ customerId: "family:nobody", feature: "retreat", delta: -1 },
		]);
	});

	test("admin_adjust: the caller's adjust lots since the import, which the shadow never saw", () => {
		const lots = [
			lot({}),
			lot({
				id: "lot_adj",
				source: "adjust:goodwill",
				every: "once",
				invoice_id: "admin:adjust:k1",
				allowance: 3,
				balance: 3,
				expires_at: null,
				created_at: T0 + 2 * HOUR,
			}),
		];
		expect(diff(member().db, { balances: { visit: 5 }, lots })).toMatchObject([
			{ delta: -3, reason: "admin_adjust", adjustedSinceImport: 3 },
		]);
		// an adjustment from before the import was imported: it is no excuse
		const older = lots.map((one) =>
			one.id === "lot_adj" ? { ...one, created_at: T0 } : one,
		);
		expect(
			diff(member().db, { balances: { visit: 5 }, lots: older }),
		).toMatchObject([{ reason: "unexplained", adjustedSinceImport: 0 }]);
	});

	test("unrenewed_cycle: past the reset with no renewal paid, tfd still holds the cycle", () => {
		expect(
			diff(
				member().db,
				{ balances: { visit: 0 }, lots: [lot({})] },
				{ now: T1 + DAY },
			),
		).toMatchObject([{ delta: 2, reason: "unrenewed_cycle" }]);
		// before the reset the same gap is not excused by it
		expect(
			diff(member().db, { balances: { visit: 0 }, lots: [lot({})] }),
		).toMatchObject([{ delta: 2, reason: "unexplained" }]);
	});

	test("upgrade_grant: tfd granted for an invoice since the import more than the caller's lots of it", () => {
		// in_1 was paid after the import; the caller grants its credits only at the next renewal (no lot yet)
		expect(
			diff(
				member().db,
				{ balances: { visit: 0 }, lots: [] },
				{ importedAt: T0 - HOUR },
			),
		).toMatchObject([{ delta: 2, reason: "upgrade_grant" }]);
		// with no lots given, nothing says what the caller granted: not excused
		expect(
			diff(member().db, { balances: { visit: 0 } }, { importedAt: T0 - HOUR }),
		).toMatchObject([{ reason: "unexplained" }]);
	});

	test("rollover_cap: tfd is short by what its renewal expired over the cap", () => {
		const capped: Menu = {
			...menu,
			tiers: menu.tiers.map((tier) =>
				tier.id === "sparkle-2"
					? {
							...tier,
							grants: tier.grants.map((grant) => ({
								...grant,
								rollover: { max: 1, months: 1 },
							})),
						}
					: tier,
			),
		};
		const h = member(capped);
		const renewal = invoicePaid({
			eventId: "evt_in_2",
			invoiceId: "in_2",
			at: T1,
			subscriptionId: "sub_1",
			reason: "subscription_cycle",
			periodStart: T1,
			periodEnd: T2,
			lines: [{ lookupKey: tierKey(), amount: GROSS, interval: "month" }],
			metadata: { b4u_school: SCHOOL, family_id: FAMILY },
		});
		expect(h.deliver(renewal, T1).status).toBe(200);
		const now = T1 + DAY;
		const lots = [
			lot({}),
			lot({ id: "lot_2", invoice_id: "in_2", expires_at: T2, created_at: T1 }),
		];
		// the caller never caps: last cycle's 2 still live beside this cycle's 2; tfd kept 1 of them
		const shadow = diffBalances({
			db: h.db,
			school: SCHOOL,
			catalog: menuCatalogRows({ menu: capped, school: SCHOOL }),
			now,
			importedAt: T0 + HOUR,
			members: [
				{
					customerId: HOLDER,
					balances: { visit: 4 },
					lots: lots.map((one) =>
						one.id === "lot_1" ? { ...one, expires_at: T2 } : one,
					),
				},
			],
		});
		expect(shadow).toMatchObject([
			{ callerBalance: 4, tfdBalance: 3, delta: -1, reason: "rollover_cap" },
		]);
	});

	test("expiry_dst: a lot and tfd's row lapse an hour apart, and now falls between", () => {
		const lapse = Date.parse("2026-03-09T06:00:00Z");
		const db = shadowOf([oneOff("ce_once_in_7_pack_visit", 3, lapse)]);
		const lots = [
			lot({
				id: "lot_7",
				invoice_id: "in_7",
				every: "month",
				allowance: 3,
				balance: 3,
				expires_at: lapse - HOUR,
			}),
		];
		expect(
			diff(db, { balances: { visit: 0 }, lots }, { now: lapse - HOUR / 2 }),
		).toMatchObject([{ delta: 3, reason: "expiry_dst" }]);
		// the other way round: the lot still live, tfd's row lapsed
		const later = [
			{ ...lots[0], expires_at: lapse + HOUR } as CallerCreditLotRow,
		];
		expect(
			diff(
				db,
				{ balances: { visit: 3 }, lots: later },
				{ now: lapse + HOUR / 2 },
			),
		).toMatchObject([{ delta: -3, reason: "expiry_dst" }]);
		// two hours apart is not one expiry in two zones
		const far = [
			{ ...lots[0], expires_at: lapse - 2 * HOUR } as CallerCreditLotRow,
		];
		expect(
			diff(db, { balances: { visit: 0 }, lots: far }, { now: lapse - HOUR }),
		).toMatchObject([{ reason: "unexplained" }]);
	});

	test("gift_expiry: a one-time lot that never lapses, tfd's row of the same invoice lapsed by its gift rule", () => {
		const lapse = T0 + 180 * DAY;
		const db = shadowOf([oneOff("ce_gift_in_9_gift_visit", 3, lapse)]);
		const lots = [
			lot({
				id: "lot_9",
				invoice_id: "in_9",
				source: "addon:gift",
				every: "once",
				allowance: 3,
				balance: 3,
				expires_at: null,
			}),
		];
		expect(
			diff(db, { balances: { visit: 3 }, lots }, { now: lapse + DAY }),
		).toMatchObject([
			{ callerBalance: 3, tfdBalance: 0, reason: "gift_expiry" },
		]);
		// before tfd's expiry both hold it: no difference
		expect(
			diff(db, { balances: { visit: 3 }, lots }, { now: lapse - DAY }),
		).toEqual([]);
	});

	test("the result is sorted by member then feature, and reads nothing it should not write", () => {
		const h = member();
		const before = h.raw.query(`SELECT count(*) AS n FROM atm_rows`).get();
		const out = diffBalances({
			db: h.db,
			school: SCHOOL,
			catalog,
			now: T0 + DAY,
			importedAt: T0 + HOUR,
			members: [
				{ customerId: "family:zz", balances: { visit: 1, retreat: 1 } },
				{ customerId: HOLDER, balances: { visit: 1 } },
			],
		});
		expect(out.map((one) => `${one.customerId}:${one.feature}`)).toEqual([
			`${HOLDER}:visit`,
			"family:zz:retreat",
			"family:zz:visit",
		]);
		expect(h.raw.query(`SELECT count(*) AS n FROM atm_rows`).get()).toEqual(
			before,
		);
	});
});
