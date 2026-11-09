/**
 * `policy.rulesVersion` (0.11.0, D12 decisions 3 and 5): rules version 2 counts rollover and one-time expiry months on
 * the menu's calendar, and the engine's `reset` is told the zone; version 1 (and a policy stored without the field) keeps
 * every command and decision as it was. `giftSessionMonths: null` gives gifts their grant's own rule (rollover months or
 * never).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { SubjectState } from "@autumn/balance-engine";
import { addMonthsInTimeZone } from "../../balance-engine/src/commands/reset/zonedRolloverExpiry.js";
import { grantsStateFromCallerRows } from "../src/billing/adopt.js";
import {
	createSessionGiftCode,
	redeemSessionGiftCode,
} from "../src/billing/codes.js";
import {
	addExpiryMonths,
	addUtcMonths,
	addZonedMonths,
	EMPTY_GRANTS_STATE,
	expiryZoneOf,
	type GrantCommand,
	type GrantsState,
	invoiceToCommands,
	menuCatalogRows,
	refundToCommands,
	rolloverExpiry,
	subscriptionEndedToCommands,
} from "../src/billing/grants.js";
import { DEFAULT_POLICY, resolvePolicy } from "../src/billing/policy.js";
import { rowsFromState, subjectFromRows } from "../src/billing/rows.js";
import type {
	BillingInvoice,
	BillingPolicy,
	BillingRefund,
	Menu,
	SubscriptionFact,
} from "../src/billing/types.js";
import { runOnState, toCatalog } from "../src/ledger/run.js";
import type { CallerCreditLotRow, CallerMembershipRow } from "../src/types.js";

const dir = `${import.meta.dir}/../fixtures/billing/grants`;
const load = <T>(name: string): T =>
	JSON.parse(readFileSync(`${dir}/${name}.json`, "utf8")) as T;
/** The fixture menu is on America/Denver, whose clocks go forward on 2026-03-08 and back on 2026-11-01. */
const menu = load<Menu>("menu");
const D = (iso: string) => Date.parse(iso);
const HOUR_MS = 3_600_000;
const SCHOOL = "sch_vol";
const HOLDER = "family:fam_8k2";
const catalogRows = menuCatalogRows({ menu, school: SCHOOL });
const catalog = toCatalog(catalogRows);
const V = { menuVersion: 3, policyVersion: 1 };
const ZONED: BillingPolicy = { ...DEFAULT_POLICY, rulesVersion: 2 };
const S2 = "ce_tier_visit_month";
/** The February renewal's boundary: 11:00 in Denver (MST); a month on is 11:00 MDT, an hour earlier in UTC. */
const FEB_BOUNDARY = D("2026-02-15T18:00:00Z");

const world = (policy: BillingPolicy) => {
	let engine: SubjectState | null = null;
	let grants: GrantsState = EMPTY_GRANTS_STATE;
	const log: GrantCommand[] = [];
	const run = (commands: GrantCommand[]) => {
		for (const command of commands) {
			const result = runOnState({ state: engine, catalog, command });
			engine = result.state;
			log.push(command);
		}
	};
	const subject = () =>
		engine === null
			? null
			: subjectFromRows({
					identity: {
						orgId: SCHOOL,
						env: "live",
						customerId: HOLDER,
						entityId: null,
					},
					revision: 0,
					rows: rowsFromState(engine),
					catalog: catalogRows,
				});
	return {
		log,
		get engine() {
			return engine as SubjectState;
		},
		get grants() {
			return grants;
		},
		invoice(invoice: BillingInvoice) {
			const result = invoiceToCommands({
				invoice,
				menu,
				policy,
				state: grants,
				now: invoice.paidAt,
				...V,
			});
			grants = result.state;
			run(result.commands);
			return result;
		},
		refund(refund: BillingRefund) {
			const result = refundToCommands({
				refund,
				policy,
				state: grants,
				now: refund.at,
				subject: subject(),
				...V,
			});
			grants = result.state;
			run(result.commands);
			return result;
		},
		end(fact: SubscriptionFact) {
			const result = subscriptionEndedToCommands({
				subscription: fact,
				menu,
				policy,
				state: grants,
				subject: subject(),
				now: fact.at,
				...V,
			});
			grants = result.state;
			run(result.commands);
			return result;
		},
	};
};

const renewedOnce = (policy: BillingPolicy) => {
	const w = world(policy);
	w.invoice(load<BillingInvoice>("inv-create-s2"));
	w.invoice(load<BillingInvoice>("inv-cycle-s2-feb"));
	return w;
};

describe("the policy field", () => {
	test("absent and 1 count on the UTC calendar, 2 on the menu's", () => {
		expect(expiryZoneOf(DEFAULT_POLICY, menu)).toBeNull();
		expect(expiryZoneOf({ rulesVersion: 1 }, menu)).toBeNull();
		expect(expiryZoneOf(undefined, menu)).toBeNull();
		expect(expiryZoneOf(ZONED, menu)).toBe("America/Denver");
		// 3 is 2 and the unpaid-cycle lapse
		expect(expiryZoneOf({ rulesVersion: 3 }, menu)).toBe("America/Denver");
		expect(addExpiryMonths(FEB_BOUNDARY, 1, null)).toBe(
			addUtcMonths(FEB_BOUNDARY, 1),
		);
		expect(addExpiryMonths(FEB_BOUNDARY, 1, "America/Denver")).toBe(
			D("2026-03-15T17:00:00Z"),
		);
	});

	test("the default policy carries no rules version, so a school's stored context hashes as before", () => {
		expect("rulesVersion" in DEFAULT_POLICY).toBe(false);
		expect("rulesVersion" in resolvePolicy(null)).toBe(false);
		expect("rulesVersion" in resolvePolicy({ giftSessionMonths: 9 })).toBe(
			false,
		);
	});

	test("resolvePolicy takes rules versions 2 and 3 and a null gift month count, and refuses anything else", () => {
		expect(
			resolvePolicy({ rulesVersion: 2, giftSessionMonths: null }),
		).toMatchObject({ rulesVersion: 2, giftSessionMonths: null });
		expect(resolvePolicy({ rulesVersion: 1 }).rulesVersion).toBe(1);
		expect(resolvePolicy({ rulesVersion: 3 }).rulesVersion).toBe(3);
		expect(() => resolvePolicy({ rulesVersion: 4 })).toThrow(
			/rulesVersion must be equal to one of the allowed values/,
		);
		expect(() => resolvePolicy({ giftSessionMonths: 0 })).toThrow(
			/giftSessionMonths/,
		);
	});
});

describe("rules version 1 replays unchanged", () => {
	test("an explicit 1 decides the same commands, byte for byte, as a policy stored without the field", () => {
		const stored = renewedOnce(DEFAULT_POLICY);
		const explicit = renewedOnce({ ...DEFAULT_POLICY, rulesVersion: 1 });
		expect(JSON.stringify(explicit.log)).toBe(JSON.stringify(stored.log));
		expect(JSON.stringify(explicit.engine)).toBe(JSON.stringify(stored.engine));
		expect(JSON.stringify(explicit.grants)).toBe(JSON.stringify(stored.grants));
	});

	test("its reset sends the org as before, with no zone, and the rollover lapses on the UTC calendar", () => {
		const w = renewedOnce(DEFAULT_POLICY);
		const reset = w.log.find((command) => command.type === "reset");
		expect(reset?.org).toEqual({
			config: {
				reverse_deduction_order: false,
				block_overdue_entitlements: false,
				include_past_due: true,
			},
		});
		expect(w.engine.rollovers.map((r) => r.expires_at)).toEqual([
			addUtcMonths(FEB_BOUNDARY, 1),
		]);
	});
});

describe("rules version 2: the menu's zone", () => {
	test("the engine's reset dates the rollover a month on in Denver, across the clocks going forward", () => {
		const w = renewedOnce(ZONED);
		const reset = w.log.find((command) => command.type === "reset");
		expect(reset?.org).toMatchObject({
			config: { rollover_time_zone: "America/Denver" },
		});
		const expiry = D("2026-03-15T17:00:00Z");
		expect(w.engine.rollovers.map((r) => r.expires_at)).toEqual([expiry]);
		expect(expiry).toBe(addZonedMonths(FEB_BOUNDARY, 1, "America/Denver"));
		expect(expiry).toBe(addUtcMonths(FEB_BOUNDARY, 1) - HOUR_MS);
		// What the grants state expects the rollover to be is what the engine made.
		expect(w.grants.invoices.in_1?.granted[0]?.rolloverExpiresAt).toBe(expiry);
	});

	test("a renewal that crosses no clock change gives the same instant as rules version 1", () => {
		const zoned = world(ZONED);
		const utc = world(DEFAULT_POLICY);
		for (const name of [
			"inv-create-s2",
			"inv-cycle-s2-feb",
			"inv-cycle-s2-mar",
			"inv-cycle-s2-apr",
		]) {
			zoned.invoice(load<BillingInvoice>(name));
			utc.invoice(load<BillingInvoice>(name));
		}
		// The April renewal's rollover was made at the March boundary (MDT), a month before April's (MDT).
		const newest = (w: ReturnType<typeof world>) =>
			Math.max(...w.engine.rollovers.map((r) => r.expires_at ?? 0));
		expect(newest(zoned)).toBe(newest(utc));
	});

	test("a full refund after the renewal finds the invoice's credits in the zoned rollover and takes them", () => {
		const w = renewedOnce(ZONED);
		const refund = {
			...load<BillingRefund>("refund-full"),
			at: D("2026-02-20T10:00:00Z"),
		};
		const result = w.refund(refund);
		expect(result.commands).toHaveLength(1);
		const ops = (
			result.commands[0] as unknown as { ops: { op: string; table: string }[] }
		).ops;
		expect(
			ops.some((op) => op.table === "rollovers" && op.op === "delete"),
		).toBe(true);
		const live = w.engine.rollovers.filter(
			(r) => r.expires_at === null || r.expires_at > refund.at,
		);
		expect(live.reduce((sum, r) => sum + r.balance, 0)).toBe(0);
	});

	test("a one-time add-on lapses its rollover months on in the menu's zone", () => {
		const pack = load<BillingInvoice>("inv-create-s2-pack");
		const once = (policy: BillingPolicy) => {
			const w = world(policy);
			w.invoice(pack);
			return w.engine.customerEntitlements.find((r) =>
				r.id.startsWith("ce_once_"),
			)?.expires_at;
		};
		expect(once(DEFAULT_POLICY)).toBe(addUtcMonths(pack.paidAt, 3));
		expect(once(ZONED)).toBe(addZonedMonths(pack.paidAt, 3, menu.timeZone));
		expect(once(ZONED)).toBe((once(DEFAULT_POLICY) as number) - HOUR_MS);
	});

	test("a canceled membership's last credits lapse where the zoned rollover would have", () => {
		const fact = (policy: BillingPolicy) => {
			const w = world(policy);
			w.invoice(load<BillingInvoice>("inv-create-s2"));
			const at = D("2026-02-01T12:00:00Z");
			w.end({
				source: {
					eventId: "evt_sub_deleted",
					mapping: "stripe-2026-10-28@1",
					stripeApiVersion: "2026-10-28",
				},
				id: w.grants.subscriptionId as string,
				status: "canceled",
				at,
			} as SubscriptionFact);
			return w.engine.customerEntitlements.find((r) => r.id === S2)?.expires_at;
		};
		expect(fact(DEFAULT_POLICY)).toBe(addUtcMonths(FEB_BOUNDARY, 1));
		expect(fact(ZONED)).toBe(addZonedMonths(FEB_BOUNDARY, 1, menu.timeZone));
	});

	test("an imported member's newest lot expects the zoned rollover", () => {
		const created = D("2026-01-15T18:00:05Z");
		const membership: CallerMembershipRow = {
			id: "mem_1",
			school_id: SCHOOL,
			family_id: "fam_8k2",
			profile_id: null,
			tier_id: "sparkle-2",
			interval: "month",
			addon_ids: "",
			menu_version: 3,
			stripe_customer_id: "cus_1",
			quantity: 1,
			stripe_subscription_id: "sub_1",
			status: "active",
			current_period_end: FEB_BOUNDARY / 1000,
			cancel_at_period_end: 0,
			revision: 1,
			stripe_event_at: Math.floor(created / 1000),
			created_at: Math.floor(created / 1000),
			updated_at: Math.floor(created / 1000),
		};
		const lot: CallerCreditLotRow = {
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
			// The caller dates its lot a rollover month after the cycle's end, in the school's zone.
			expires_at: addZonedMonths(FEB_BOUNDARY, 1, menu.timeZone),
			created_at: created,
		};
		const imported = (policy?: BillingPolicy) =>
			grantsStateFromCallerRows({
				membership,
				lots: [lot],
				menu,
				now: D("2026-01-20T00:00:00Z"),
				...(policy ? { policy } : {}),
			}).state.invoices.in_1?.granted[0]?.rolloverExpiresAt;
		expect(imported()).toBe(addUtcMonths(FEB_BOUNDARY, 1));
		expect(imported(ZONED)).toBe(
			addZonedMonths(FEB_BOUNDARY, 1, menu.timeZone),
		);
	});
});

describe("the engine's zone math is tfd's", () => {
	test("addMonthsInTimeZone and addZonedMonths agree on every 13th hour of 2026 in zones with odd clock changes", () => {
		const zones = [
			"America/Denver",
			"Europe/London",
			"Australia/Lord_Howe",
			"America/St_Johns",
			"Pacific/Chatham",
			"UTC",
		];
		let checked = 0;
		for (const timeZone of zones)
			for (
				let instant = D("2026-01-01T00:00:00Z");
				instant < D("2027-01-01T00:00:00Z");
				instant += 13 * HOUR_MS + 7 * 60_000
			)
				for (const months of [1, 6]) {
					checked++;
					const engine = addMonthsInTimeZone({ instant, months, timeZone });
					if (engine !== addZonedMonths(instant, months, timeZone))
						throw new Error(
							`${timeZone} ${new Date(instant).toISOString()} +${months}: the engine and tfd disagree`,
						);
				}
		expect(checked).toBeGreaterThan(8000);
	});

	test("a wall time the clocks skip, and one they pass twice, land where tfd puts them", () => {
		// 02:30 MST on 8 February: a month on, 02:30 on 8 March does not happen; read with MST it is 03:30 MDT.
		const skipped = D("2026-02-08T09:30:00Z");
		expect(
			addMonthsInTimeZone({
				instant: skipped,
				months: 1,
				timeZone: "America/Denver",
			}),
		).toBe(D("2026-03-08T09:30:00Z"));
		// 01:30 MDT on 1 October: a month on, 01:30 on 1 November happens twice; the first (MDT) is taken.
		const twice = D("2026-10-01T07:30:00Z");
		expect(
			addMonthsInTimeZone({
				instant: twice,
				months: 1,
				timeZone: "America/Denver",
			}),
		).toBe(D("2026-11-01T07:30:00Z"));
		expect(rolloverExpiry({ months: 1 }, twice, "America/Denver")).toBe(
			D("2026-11-01T07:30:00Z"),
		);
	});
});

describe("gifts that never lapse (decision 5)", () => {
	const NEVER: BillingPolicy = { ...ZONED, giftSessionMonths: null };
	const giftRow = (policy: BillingPolicy, change: Partial<Menu> = {}) => {
		const gifted = { ...menu, ...change };
		const result = invoiceToCommands({
			invoice: load<BillingInvoice>("inv-gift-sessions"),
			menu: gifted,
			policy,
			state: EMPTY_GRANTS_STATE,
			now: load<BillingInvoice>("inv-gift-sessions").paidAt,
			...V,
		});
		const plan = result.commands[0] as unknown as {
			ops: { row?: { id: string; expires_at: number | null } }[];
		};
		return plan.ops.find((op) => op.row?.id.startsWith("ce_gift_"))?.row;
	};

	test("with gift months, a session gift lapses that many months on, as before", () => {
		const paidAt = load<BillingInvoice>("inv-gift-sessions").paidAt;
		expect(giftRow(ZONED)?.expires_at).toBe(
			addZonedMonths(paidAt, 6, menu.timeZone),
		);
	});

	test("with null, a gift whose grant has no rollover never lapses", () => {
		expect(giftRow(NEVER)?.expires_at).toBeNull();
	});

	test("with null, a gift whose grant has rollover months lapses that many months on", () => {
		const paidAt = load<BillingInvoice>("inv-gift-sessions").paidAt;
		const addons = menu.addons.map((addon) =>
			addon.id === "gift-visit"
				? {
						...addon,
						grants: addon.grants.map((grant) => ({
							...grant,
							rollover: { months: 2 },
						})),
					}
				: addon,
		);
		expect(giftRow(NEVER, { addons })?.expires_at).toBe(
			addZonedMonths(paidAt, 2, menu.timeZone),
		);
	});

	test("with null, a session gift code's credits never lapse", () => {
		const made = createSessionGiftCode({
			id: "code_1",
			code: "VISIT-FOR-YOU",
			featureId: "visit",
			credits: 2,
			redeemBy: D("2026-04-01T00:00:00Z"),
			createdAt: D("2026-01-15T18:00:00Z"),
			menu,
			policy: NEVER,
		});
		if (!made.ok) throw new Error(made.message);
		expect(made.code.creditMonths).toBeNull();
		const redeemed = redeemSessionGiftCode({
			code: made.code,
			entered: "visit-for-you",
			holder: { orgId: SCHOOL, customerId: HOLDER },
			menu,
			menuVersion: 3,
			policy: NEVER,
			policyVersion: 1,
			rows: [],
			revision: 0,
			catalog: catalogRows,
			now: D("2026-02-01T00:00:00Z"),
		});
		if (!redeemed.ok) throw new Error(redeemed.message);
		expect(redeemed.redeemed.expiresAt).toBeNull();
		const row = redeemed.rowChanges?.upserts.find(
			(upsert) => upsert.table === "customerEntitlements",
		);
		expect(row?.data).toMatchObject({ expires_at: null });
	});
});
