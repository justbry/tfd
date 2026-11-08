/**
 * Moving a caller that grants on its own onto `handleStripeEvent`: `grantsStateFromCallerRows` builds atm's rows from
 * B4 Uni's `school_memberships` and `school_credit_lots`. The caller's own grant rule (family-service
 * `src/school-billing/grant.ts`) is ported below as `callerGrant`, by hand, and is the oracle: what a renewal after the
 * import grants (units, expiry, rollover) is compared with what that rule grants for the same invoice.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { grantsStateFromCallerRows } from "../src/billing/adopt.js";
import { menuCatalogRows } from "../src/billing/grants.js";
import { handleStripeEvent } from "../src/billing/handle.js";
import { DEFAULT_POLICY } from "../src/billing/policy.js";
import {
	applyRowChanges,
	type BillingRow,
	grantsFromRows,
	rowsFromState,
	stateFromRows,
} from "../src/billing/rows.js";
import {
	addonPriceKey,
	lookupKeyOf,
	menuLineItems,
	tierPriceKey,
} from "../src/billing/stripe-menu.js";
import { deterministicUlid } from "../src/ledger/ids.js";
import {
	balancesOf,
	HANDLER_COMMAND,
	replayEvents,
} from "../src/ledger/replay.js";
import { toCatalog } from "../src/ledger/run.js";
import { membersOf } from "../src/ledger/summary.js";
import { isoInstant } from "../src/ledger/util.js";
import { validateEvent } from "../src/ledger/validate.js";
import type {
	AtmEvent,
	CallerCreditLotRow,
	CallerMembershipRow,
	GrantsState,
	Menu,
	StripeEventResult,
} from "../src/types.js";
import {
	type CallerInvoice,
	callerAdjust,
	callerAvail,
	callerGrant,
	callerRaise,
} from "./caller-lots.js";
import {
	chargeRefunded,
	invoicePaid,
	paymentIntentOf,
	priceIdOf,
} from "./stripe-events.js";

const SCHOOL = "sch_vol";
const FAMILY = "fam_8k2";
const HOLDER = `family:${FAMILY}`;
const D = (iso: string) => Date.parse(iso);
const HOUR_MS = 3_600_000;

const baseMenu = JSON.parse(
	readFileSync(
		`${import.meta.dir}/../fixtures/billing/grants/menu.json`,
		"utf8",
	),
) as Menu;
/** The school's calendar is UTC unless a test says otherwise, so month arithmetic agrees between the caller and atm. */
const utcMenu: Menu = { ...baseMenu, timeZone: "UTC" };

// ---- Fixtures -----------------------------------------------------------------------------------------------------

const secondsOf = (ms: number) => Math.floor(ms / 1000);

const membershipRow = (
	overrides: Partial<CallerMembershipRow> = {},
): CallerMembershipRow => ({
	id: "mem_1",
	school_id: SCHOOL,
	family_id: FAMILY,
	profile_id: null,
	tier_id: "sparkle-2",
	interval: "month",
	addon_ids: "",
	menu_version: 3,
	stripe_customer_id: "cus_1",
	quantity: 1,
	stripe_subscription_id: "sub_1",
	status: "active",
	current_period_end: secondsOf(D("2026-03-15T18:00:00Z")),
	cancel_at_period_end: 0,
	revision: 4,
	stripe_event_at: secondsOf(D("2026-02-15T18:00:10Z")),
	created_at: secondsOf(D("2026-01-15T18:00:10Z")),
	updated_at: secondsOf(D("2026-02-15T18:00:10Z")),
	...overrides,
});

/** The three cycles of the main scenario: paid on the 15th at 18:00:10 UTC, each for the month that follows. */
const JAN = D("2026-01-15T18:00:00Z");
const FEB = D("2026-02-15T18:00:00Z");
const MAR = D("2026-03-15T18:00:00Z");
const APR = D("2026-04-15T18:00:00Z");
const invoiceAt = (
	id: string,
	reason: CallerInvoice["reason"],
	periodStart: number,
	periodEnd: number,
): CallerInvoice => ({
	id,
	reason,
	periodStart,
	periodEnd,
	atMs: periodStart + 10_000,
});
const IN_1 = invoiceAt("in_1", "subscription_create", JAN, FEB);
const IN_2 = invoiceAt("in_2", "subscription_cycle", FEB, MAR);
const IN_3 = invoiceAt("in_3", "subscription_cycle", MAR, APR);

const tierKey = (menu: Menu, tierId: string, interval: "month" | "year") => {
	const price = menu.tiers
		.find((t) => t.id === tierId)
		?.prices.find((p) => p.interval === interval);
	return lookupKeyOf(
		SCHOOL,
		tierPriceKey(tierId, interval),
		price?.amount as number,
		menu.currency,
	);
};
const addonKey = (menu: Menu, addonId: string) => {
	const addon = menu.addons.find(
		(a) => a.id === addonId,
	) as Menu["addons"][number];
	return lookupKeyOf(
		SCHOOL,
		addonPriceKey(addon.id, addon.price.every, addon.gift),
		addon.price.amount,
		menu.currency,
	);
};

/** The invoice.paid event for a caller invoice: the tier's line, and the add-ons the membership holds. */
const paidEvent = ({
	menu,
	membership,
	invoice,
}: {
	menu: Menu;
	membership: CallerMembershipRow;
	invoice: CallerInvoice;
}) => {
	const tier = menu.tiers.find(
		(t) => t.id === membership.tier_id,
	) as Menu["tiers"][number];
	const price = tier.prices.find((p) => p.interval === membership.interval);
	const lines = [
		{
			lookupKey: tierKey(menu, tier.id, membership.interval),
			amount: (price?.amount ?? 0) * membership.quantity,
			interval: membership.interval,
			quantity: membership.quantity,
		},
	];
	for (const id of membership.addon_ids.split(",").filter(Boolean)) {
		const addon = menu.addons.find(
			(a) => a.id === id,
		) as Menu["addons"][number];
		if (
			addon.price.every === "once" &&
			invoice.reason !== "subscription_create"
		)
			continue;
		lines.push({
			lookupKey: addonKey(menu, id),
			amount: addon.price.amount,
			interval:
				addon.price.every === "once" ? (null as never) : addon.price.every,
			quantity: 1,
		});
	}
	return invoicePaid({
		eventId: `evt_${invoice.id}`,
		invoiceId: invoice.id,
		at: invoice.atMs,
		subscriptionId: membership.stripe_subscription_id,
		reason: invoice.reason,
		periodStart: invoice.periodStart,
		periodEnd: invoice.periodEnd,
		lines,
		metadata: { b4u_school: SCHOOL, family_id: FAMILY },
	});
};

/** atm's side: rows and revision as the family service would store them, one handled event at a time. */
const atmStore = (
	menu: Menu,
	initial: readonly BillingRow[] = [],
	/** Payment intent to invoice id for invoices handled before the import: atm cannot read them from the caller's rows. */
	knownPayments: Readonly<Record<string, string>> = {},
) => {
	const catalogRows = menuCatalogRows({ menu, school: SCHOOL });
	const catalog = toCatalog(catalogRows);
	const priceIds = Object.fromEntries(
		[...menuLineItems(SCHOOL, menu).keys()].map((key) => [key, priceIdOf(key)]),
	);
	const invoiceIds: Record<string, string> = { ...knownPayments };
	let rows: BillingRow[] = [...initial];
	let revision = 1;
	return {
		get rows() {
			return rows;
		},
		get grants() {
			return grantsFromRows(rows);
		},
		handle(event: unknown, at: number): StripeEventResult {
			const raw = event as {
				id: string;
				type: string;
				data: { object: { id: string } };
			};
			if (raw.type === "invoice.paid")
				invoiceIds[paymentIntentOf(raw.data.object.id)] = raw.data.object.id;
			const result = handleStripeEvent({
				event,
				eventId: deterministicUlid({
					timeMs: at,
					revision: 0,
					seed: JSON.stringify([SCHOOL, raw.id]),
				}),
				menu,
				menuVersion: 3,
				policy: DEFAULT_POLICY,
				policyVersion: 1,
				rows,
				revision,
				catalog: catalogRows,
				now: at,
				priceIds,
				invoiceIds,
			});
			if (result.rowChanges)
				({ rows, revision } = applyRowChanges({
					rows,
					revision,
					changes: result.rowChanges,
				}));
			return result;
		},
		/** The units the engine counts as available at `asOfMs`: refilling rows and live rollovers. */
		avail(asOfMs: number, feature = "visit"): number {
			const state = stateFromRows({
				identity: {
					orgId: SCHOOL,
					env: "live",
					customerId: HOLDER,
					entityId: null,
				},
				revision,
				rows,
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
		},
		rowsOf: (table: BillingRow["table"]) =>
			rows.filter((r) => r.table === table),
	};
};

const only = <T>(items: readonly T[]): T => {
	expect(items).toHaveLength(1);
	return items[0] as T;
};

// ---- Tests --------------------------------------------------------------------------------------------------------

describe("a member mid-cycle, moved onto atm", () => {
	// January's lot has 1 of its 2 left; February's lot (paid at renewal) has 2 of 2; it is the 25th of February.
	const membership = membershipRow();
	const januaryLot = {
		...only(
			callerGrant({ membership, menu: utcMenu, invoice: IN_1, existing: [] }),
		),
		balance: 1,
	};
	const februaryLot = only(
		callerGrant({
			membership,
			menu: utcMenu,
			invoice: IN_2,
			existing: [januaryLot],
		}),
	);
	const lots = [januaryLot, februaryLot];
	const now = D("2026-02-25T12:00:00Z");
	const imported = grantsStateFromCallerRows({
		membership,
		lots,
		menu: utcMenu,
		now,
	});

	test("the caller's rule, as ported, gives lots that last a cycle and a rollover month", () => {
		expect(januaryLot).toMatchObject({
			allowance: 2,
			expires_at: D("2026-03-15T18:00:00Z"),
		});
		expect(februaryLot).toMatchObject({
			allowance: 2,
			expires_at: D("2026-04-15T18:00:00Z"),
		});
	});

	test("the newest lot is the refilling row, the older one's leftover its rollover, each invoice a decided invoice", () => {
		const store = atmStore(utcMenu, imported.rows);
		const row = only(store.rowsOf("customerEntitlements"));
		expect(row.data).toMatchObject({
			id: "ce_tier_visit_month",
			balance: 2,
			next_reset_at: MAR,
			expires_at: null,
			created_at: JAN + 10_000,
		});
		expect(only(store.rowsOf("rollovers")).data).toMatchObject({
			cus_ent_id: "ce_tier_visit_month",
			balance: 1,
			expires_at: januaryLot.expires_at,
		});
		expect(imported.state).toMatchObject({
			identity: { orgId: SCHOOL, customerId: HOLDER },
			subscriptionId: "sub_1",
			tierId: "sparkle-2",
			interval: "month",
			quantity: 1,
			cycleStart: FEB,
			cycleEnd: MAR,
			anchor: null,
			endedAt: null,
			rows: { ce_tier_visit_month: 2 },
		});
		expect(Object.keys(imported.state.invoices).sort()).toEqual([
			"in_1",
			"in_2",
		]);
		expect(imported.state.membership).toMatchObject({
			status: "active",
			tierId: "sparkle-2",
			renewsAt: MAR,
			at: D("2026-02-15T18:00:10Z"),
		});
		// What the engine counts equals what the caller counts, now and as each lot lapses.
		for (const at of [
			now,
			D("2026-03-14T00:00:00Z"),
			D("2026-03-16T00:00:00Z"),
			D("2026-04-14T00:00:00Z"),
		])
			expect(store.avail(at)).toBe(callerAvail(lots, at));
	});

	test("the renewal after the import grants what the caller's rule grants: units, expiry and rollover", () => {
		const store = atmStore(utcMenu, imported.rows);
		const expected = only(
			callerGrant({ membership, menu: utcMenu, invoice: IN_3, existing: lots }),
		);
		const result = store.handle(
			paidEvent({ menu: utcMenu, membership, invoice: IN_3 }),
			IN_3.atMs,
		);
		expect(result.refused).toBeUndefined();
		expect(result.rowChanges).not.toBeNull();

		// Units: the invoice grants the caller's allowance, and the row is refilled to it.
		const grantedNow = only(store.grants.invoices.in_3?.granted ?? []);
		expect(grantedNow).toMatchObject({
			feature: "visit",
			units: expected.allowance,
		});
		expect(only(store.rowsOf("customerEntitlements")).data.balance).toBe(
			expected.allowance,
		);
		// Expiry: the credits of this invoice lapse where the caller's lot does (cycle end plus the rollover month).
		expect(grantedNow.rolloverExpiresAt).toBe(expected.expires_at);
		// Rollover: what February's cycle left carries over, expiring where the caller's February lot expires;
		// January's leftover lapsed at the same instant the cycle turned: the reset leaves it for the cron to book, and it
		// counts in neither.
		const caller = [februaryLot, expected];
		const rollover = only(
			store
				.rowsOf("rollovers")
				.filter((row) => (row.data.expires_at as number) > IN_3.atMs),
		);
		expect(rollover.data).toMatchObject({
			balance: februaryLot.balance,
			expires_at: februaryLot.expires_at,
		});
		for (const at of [
			D("2026-03-16T00:00:00Z"),
			D("2026-04-14T00:00:00Z"),
			D("2026-04-16T00:00:00Z"),
		])
			expect(store.avail(at)).toBe(callerAvail(caller, at));
		// The cycle moved on.
		expect(store.grants).toMatchObject({ cycleStart: MAR, cycleEnd: APR });
	});

	test("an invoice the caller already granted grants nothing again, whichever of them is replayed", () => {
		const store = atmStore(utcMenu, imported.rows);
		for (const invoice of [IN_1, IN_2]) {
			const result = store.handle(
				paidEvent({ menu: utcMenu, membership, invoice }),
				invoice.atMs,
			);
			expect(result.refused).toBeUndefined();
			expect(result.rowChanges).toBeNull();
			expect(result.events).toEqual([]);
		}
		expect(store.rows).toEqual(imported.rows);
	});

	test("a refund of an invoice handled before the import is refused until the caller says which invoice the payment paid", () => {
		const store = atmStore(utcMenu, imported.rows);
		const refundAt = IN_2.atMs + HOUR_MS;
		const result = store.handle(
			chargeRefunded({
				eventId: "evt_refund_in_2",
				chargeId: "ch_in_2",
				invoiceId: "in_2",
				amount: 26000,
				chargeAmount: 26000,
				at: refundAt,
			}),
			refundAt,
		);
		expect(result.refused?.reason).toBe("unmatched_invoice");
		expect(result.rowChanges).toBeNull();
	});

	test("a refund of the caller's last invoice, after the renewal, takes back what its lot still holds", () => {
		// A refund names its charge and payment intent, not its invoice. atm learned that link from `invoice_payment.paid`
		// for the invoices it handled; for one handled before the import the caller passes it as `invoiceIds`.
		const store = atmStore(utcMenu, imported.rows, {
			[paymentIntentOf("in_2")]: "in_2",
		});
		store.handle(
			paidEvent({ menu: utcMenu, membership, invoice: IN_3 }),
			IN_3.atMs,
		);
		const before = store.avail(D("2026-03-16T00:00:00Z"));
		const refundAt = IN_3.atMs + HOUR_MS;
		const result = store.handle(
			chargeRefunded({
				eventId: "evt_refund_in_2",
				chargeId: "ch_in_2",
				invoiceId: "in_2",
				amount: 26000,
				chargeAmount: 26000,
				at: refundAt,
			}),
			refundAt,
		);
		expect(result.refused).toBeUndefined();
		// The caller takes min(balance, allowance) of the invoice's lot: the 2 February left.
		expect(before - store.avail(D("2026-03-16T00:00:00Z"))).toBe(
			Math.min(februaryLot.balance, februaryLot.allowance),
		);
		expect(store.grants.invoices.in_2?.removed).toBe(true);
	});
});

describe("what the rows determine, and what moving does not make the same", () => {
	test("rows imported for a member whose first invoice atm would have handled are the rows atm itself makes", () => {
		const membership = membershipRow({
			current_period_end: secondsOf(FEB),
			stripe_event_at: secondsOf(IN_1.atMs),
			updated_at: secondsOf(IN_1.atMs),
		});
		const lots = callerGrant({
			membership,
			menu: utcMenu,
			invoice: IN_1,
			existing: [],
		});
		const imported = grantsStateFromCallerRows({
			membership,
			lots,
			menu: utcMenu,
			now: IN_1.atMs + 1000,
		});
		const native = atmStore(utcMenu, []);
		native.handle(
			paidEvent({ menu: utcMenu, membership, invoice: IN_1 }),
			IN_1.atMs,
		);
		const engineOnly = (rows: readonly BillingRow[]) =>
			rows.filter((r) => r.table !== "atm_grants");
		expect(engineOnly(imported.rows)).toEqual(engineOnly(native.rows));
		// The grants state differs only in what the lots cannot say (the billing anchor), the membership record and the menu
		// version the import pins the member to (the caller's `menu_version`).
		const {
			anchor,
			membership: record,
			menuVersion,
			...importedRest
		} = imported.state;
		expect(menuVersion).toBe("3");
		// ...and in the MRR atm booked for its own invoice: an adopted member's starts at the next invoice atm handles.
		const {
			anchor: nativeAnchor,
			membership: nativeRecord,
			mrr: nativeMrr,
			...nativeRest
		} = native.grants;
		expect(nativeMrr?.cents).toBe(26_000);
		expect(imported.state.mrr).toBeUndefined();
		// ...and in `paid`: atm's own invoice remembers that the books took its payment, an adopted one is the caller's to book.
		const unbooked = Object.fromEntries(
			Object.entries(nativeRest.invoices).map(([id, record]) => {
				const { paid, ...rest } = record;
				expect(paid).toBe(26_000);
				return [id, rest];
			}),
		);
		expect(importedRest).toEqual({ ...nativeRest, invoices: unbooked });
		expect(anchor).toBeNull();
		expect(nativeAnchor).toBe(JAN);
		expect(nativeRecord).toBeNull();
		expect(record).not.toBeNull();
	});

	test("a quantity of 2: the renewal grants twice the amount, as the caller's lot does", () => {
		const membership = membershipRow({ quantity: 2 });
		const january = only(
			callerGrant({ membership, menu: utcMenu, invoice: IN_1, existing: [] }),
		);
		const february = only(
			callerGrant({
				membership,
				menu: utcMenu,
				invoice: IN_2,
				existing: [january],
			}),
		);
		const lots = [{ ...january, balance: 0 }, february];
		const imported = grantsStateFromCallerRows({
			membership,
			lots,
			menu: utcMenu,
			now: D("2026-02-25T12:00:00Z"),
		});
		expect(imported.state.quantity).toBe(2);
		const store = atmStore(utcMenu, imported.rows);
		const expected = only(
			callerGrant({ membership, menu: utcMenu, invoice: IN_3, existing: lots }),
		);
		const result = store.handle(
			paidEvent({ menu: utcMenu, membership, invoice: IN_3 }),
			IN_3.atMs,
		);
		expect(result.refused).toBeUndefined();
		expect(expected.allowance).toBe(4);
		expect(only(store.grants.invoices.in_3?.granted ?? []).units).toBe(4);
		expect(only(store.rowsOf("customerEntitlements")).data.balance).toBe(4);
		expect(only(store.rowsOf("rollovers")).data).toMatchObject({
			balance: february.balance,
			expires_at: february.expires_at,
		});
	});

	test("a tier with a yearly grant and an add-on: the renewal grants the monthly allowance and the add-on, not the yearly grant or the one-time pack", () => {
		const membership = membershipRow({
			tier_id: "sparkle-4",
			addon_ids: "glow,pack",
		});
		const january = callerGrant({
			membership,
			menu: utcMenu,
			invoice: IN_1,
			existing: [],
		});
		// Visit (tier), retreat (yearly), glow (recurring add-on), pack (one-time, on the first invoice only).
		expect(
			january.map((l) => `${l.source}/${l.feature_id}/${l.every}`),
		).toEqual([
			"tier/visit/month",
			"tier/retreat/year",
			"addon:glow/visit/month",
			"addon:pack/visit/once",
		]);
		const february = callerGrant({
			membership,
			menu: utcMenu,
			invoice: IN_2,
			existing: january,
		});
		expect(february.map((l) => `${l.source}/${l.feature_id}`)).toEqual([
			"tier/visit",
			"addon:glow/visit",
		]);
		const lots = [...january, ...february];
		const imported = grantsStateFromCallerRows({
			membership,
			lots,
			menu: utcMenu,
			now: D("2026-02-25T12:00:00Z"),
		});
		const store = atmStore(utcMenu, imported.rows);
		const expected = callerGrant({
			membership,
			menu: utcMenu,
			invoice: IN_3,
			existing: lots,
		});
		const result = store.handle(
			paidEvent({ menu: utcMenu, membership, invoice: IN_3 }),
			IN_3.atMs,
		);
		expect(result.refused).toBeUndefined();
		const granted = (store.grants.invoices.in_3?.granted ?? []).map(
			(g) => `${g.rowId}=${g.units}`,
		);
		expect(granted.sort()).toEqual(
			["ce_tier_visit_month=4", "ce_addon_glow_visit_month=1"].sort(),
		);
		expect(expected.map((l) => `${l.source}=${l.allowance}`)).toEqual([
			"tier=4",
			"addon:glow=1",
		]);
		// The retreat (yearly) and the pack (one-time) rows are untouched by the renewal. The caller's yearly lot expires with
		// the first MONTH's period (its rule gives a grant with no rollover `expires_at` = the invoice's period end), so by
		// the 25th of February it holds nothing and the import says so; atm then refills it a year after the first invoice.
		const retreat = store
			.rowsOf("customerEntitlements")
			.find((r) => r.id === "ce_tier_retreat_year");
		expect(january.find((l) => l.feature_id === "retreat")?.expires_at).toBe(
			FEB,
		);
		expect(retreat?.data).toMatchObject({
			balance: 0,
			next_reset_at: D("2027-01-15T18:00:10Z"),
		});
		const pack = store
			.rowsOf("customerEntitlements")
			.find((r) => r.id === `ce_once_in_1_pack_visit`);
		expect(pack?.data.balance).toBe(1);
	});

	test("a membership Stripe has told the caller about but that no invoice granted yet is just the membership: the first invoice then grants as for a new member", () => {
		const membership = membershipRow({ current_period_end: secondsOf(FEB) });
		const imported = grantsStateFromCallerRows({
			membership,
			lots: [],
			menu: utcMenu,
			now: JAN,
		});
		expect(imported.rows.map((r) => r.table)).toEqual(["atm_grants"]);
		expect(imported.state).toMatchObject({
			holder: { orgId: SCHOOL, customerId: HOLDER },
			tierId: null,
			membership: { status: "active", tierId: "sparkle-2" },
		});
		const store = atmStore(utcMenu, imported.rows);
		const result = store.handle(
			paidEvent({ menu: utcMenu, membership, invoice: IN_1 }),
			IN_1.atMs,
		);
		expect(result.refused).toBeUndefined();
		expect(store.avail(JAN + 20_000)).toBe(2);
	});

	test("a canceled membership: the credits live out their own expiry and nothing refills", () => {
		const membership = membershipRow({
			status: "canceled",
			stripe_event_at: secondsOf(D("2026-02-20T00:00:00Z")),
		});
		const january = only(
			callerGrant({ membership, menu: utcMenu, invoice: IN_1, existing: [] }),
		);
		const imported = grantsStateFromCallerRows({
			membership,
			lots: [january],
			menu: utcMenu,
			now: D("2026-02-25T12:00:00Z"),
		});
		expect(imported.state.endedAt).toBe(D("2026-02-20T00:00:00Z"));
		expect(imported.state.membership?.status).toBe("ended");
		const row = only(
			imported.rows.filter((r) => r.table === "customerEntitlements"),
		);
		expect(row.data).toMatchObject({
			next_reset_at: null,
			expires_at: january.expires_at,
		});
	});

	test("a lot past its expiry holds nothing, and its leftover is not carried over", () => {
		const membership = membershipRow();
		const january = {
			...only(
				callerGrant({ membership, menu: utcMenu, invoice: IN_1, existing: [] }),
			),
			balance: 1,
		};
		const february = only(
			callerGrant({
				membership,
				menu: utcMenu,
				invoice: IN_2,
				existing: [january],
			}),
		);
		const imported = grantsStateFromCallerRows({
			membership,
			lots: [january, february],
			// After January's lot expired (Mar 15 18:00:00) and before the renewal is paid.
			menu: utcMenu,
			now: D("2026-03-15T18:00:05Z"),
		});
		expect(imported.rows.some((r) => r.table === "rollovers")).toBe(false);
		// Still a decided invoice.
		expect(imported.state.invoices.in_1).toBeDefined();
	});
});

describe("where atm's rules are not the caller's, so the same renewal grants a little differently", () => {
	test("a leftover above the rollover cap: the caller keeps all of it, atm carries at most `max`", () => {
		const membership = membershipRow();
		const january = {
			...only(
				callerGrant({ membership, menu: utcMenu, invoice: IN_1, existing: [] }),
			),
			balance: 0,
		};
		// 3 left of 2 granted (a manual top-up through updateBalance); the menu caps the rollover at 2.
		const february = {
			...only(
				callerGrant({
					membership,
					menu: utcMenu,
					invoice: IN_2,
					existing: [january],
				}),
			),
			balance: 3,
		};
		const lots = [january, february];
		const imported = grantsStateFromCallerRows({
			membership,
			lots,
			menu: utcMenu,
			now: D("2026-02-25T12:00:00Z"),
		});
		const store = atmStore(utcMenu, imported.rows);
		store.handle(
			paidEvent({ menu: utcMenu, membership, invoice: IN_3 }),
			IN_3.atMs,
		);
		const callerLots = [
			february,
			...callerGrant({
				membership,
				menu: utcMenu,
				invoice: IN_3,
				existing: lots,
			}),
		];
		const at = D("2026-03-16T00:00:00Z");
		expect(callerAvail(callerLots, at)).toBe(5);
		expect(store.avail(at)).toBe(4);
	});

	test("a school calendar that changes its clocks: atm's rollover expiry is a whole hour from the caller's lot", () => {
		const menu = baseMenu; // America/Denver
		const membership = membershipRow({ current_period_end: secondsOf(FEB) });
		// January's cycle ends Feb 15 18:00Z (11:00 in Denver, MST). A month on, the caller's lot ends at 11:00 Denver, which
		// is MDT by then: 17:00Z. atm's engine counts the rollover month on the UTC calendar: 18:00Z.
		const january = {
			...only(callerGrant({ membership, menu, invoice: IN_1, existing: [] })),
			balance: 1,
		};
		expect(january.expires_at).toBe(D("2026-03-15T17:00:00Z"));
		const imported = grantsStateFromCallerRows({
			membership,
			lots: [january],
			menu,
			now: D("2026-02-10T12:00:00Z"),
		});
		const store = atmStore(menu, imported.rows);
		const result = store.handle(
			paidEvent({ menu, membership, invoice: IN_2 }),
			IN_2.atMs,
		);
		expect(result.refused).toBeUndefined();
		const rollover = only(store.rowsOf("rollovers")).data;
		expect(rollover.balance).toBe(1);
		expect(rollover.expires_at).toBe(D("2026-03-15T18:00:00Z"));
		expect(
			(rollover.expires_at as number) - (january.expires_at as number),
		).toBe(HOUR_MS);
	});

	test("a cycle not renewed: the caller's lot lapses at the cycle end plus the rollover month, atm's refilling row stays until the next invoice or the cancellation", () => {
		const membership = membershipRow();
		const january = {
			...only(
				callerGrant({ membership, menu: utcMenu, invoice: IN_1, existing: [] }),
			),
			balance: 0,
		};
		const february = only(
			callerGrant({
				membership,
				menu: utcMenu,
				invoice: IN_2,
				existing: [january],
			}),
		);
		const imported = grantsStateFromCallerRows({
			membership,
			lots: [january, february],
			menu: utcMenu,
			now: D("2026-02-25T12:00:00Z"),
		});
		const store = atmStore(utcMenu, imported.rows);
		const lapsedAt = D("2026-04-16T00:00:00Z");
		expect(callerAvail([january, february], lapsedAt)).toBe(0);
		expect(store.avail(lapsedAt)).toBe(2);
	});
});

describe("rows that cannot be placed are refused, naming the problem", () => {
	const membership = membershipRow();
	const january = only(
		callerGrant({ membership, menu: utcMenu, invoice: IN_1, existing: [] }),
	);
	const run = (overrides: {
		membership?: Partial<CallerMembershipRow>;
		lots?: CallerCreditLotRow[];
		menu?: Menu;
	}) =>
		grantsStateFromCallerRows({
			membership: membershipRow(overrides.membership),
			lots: overrides.lots ?? [january],
			menu: overrides.menu ?? utcMenu,
			now: D("2026-01-20T00:00:00Z"),
		});

	test("the baseline imports", () => {
		expect(() => run({})).not.toThrow();
	});

	test("a repeated add-on id is one add-on", () => {
		const membershipWithGlow = membershipRow({ addon_ids: "glow" });
		const lots = callerGrant({
			membership: membershipWithGlow,
			menu: utcMenu,
			invoice: IN_1,
			existing: [],
		});
		const { state } = run({
			membership: { addon_ids: "glow,glow, glow" },
			lots,
		});
		expect(state.addonIds).toEqual(["glow"]);
	});

	test("a tier the menu does not have", () => {
		expect(() => run({ membership: { tier_id: "gold" } })).toThrow(
			/tier "gold", which the menu does not have/,
		);
	});

	test("a tier the menu does not price at the membership's interval", () => {
		expect(() =>
			run({ membership: { tier_id: "sparkle-1", interval: "year" } }),
		).toThrow(/sparkle-1 billed every year, which the menu does not price/);
	});

	test("a feature the menu does not have", () => {
		expect(() =>
			run({ lots: [{ ...january, feature_id: "massage" }] }),
		).toThrow(/feature "massage", which the menu does not have/);
	});

	test("an add-on the menu does not have", () => {
		expect(() => run({ membership: { addon_ids: "glow,nope" } })).toThrow(
			/add-on "nope", which the menu does not have/,
		);
		expect(() => run({ lots: [{ ...january, source: "addon:nope" }] })).toThrow(
			/add-on "nope", which the menu does not have/,
		);
	});

	test("a lot that is no grant of the membership's tier", () => {
		expect(() =>
			run({ lots: [{ ...january, feature_id: "retreat" }] }),
		).toThrow(/is not a grant of tier sparkle-2/);
	});

	test("a tier grant, or an add-on, with no lot: atm would never refill it", () => {
		expect(() => run({ membership: { tier_id: "sparkle-4" } })).toThrow(
			/no lot for tier sparkle-4's grant of retreat every year/,
		);
		expect(() => run({ membership: { addon_ids: "glow" } })).toThrow(
			/no lot for add-on glow's grant of visit/,
		);
	});

	test("a lot of another member, and a source atm does not know", () => {
		expect(() =>
			run({ lots: [{ ...january, membership_id: "mem_9" }] }),
		).toThrow(/belongs to membership mem_9/);
		expect(() => run({ lots: [{ ...january, source: "promo" }] })).toThrow(
			/source atm does not know/,
		);
		expect(() => run({ lots: [{ ...january, source: "adjust:" }] })).toThrow(
			/source atm does not know/,
		);
	});

	test("credit rows on different cycles: a renewal was granted to some and not others", () => {
		const withGlow = membershipRow({ tier_id: "sparkle-4", addon_ids: "glow" });
		const first = callerGrant({
			membership: withGlow,
			menu: utcMenu,
			invoice: IN_1,
			existing: [],
		});
		const second = callerGrant({
			membership: withGlow,
			menu: utcMenu,
			invoice: IN_2,
			existing: first,
		});
		const pick = (
			lots: CallerCreditLotRow[],
			source: string,
			feature: string,
		) =>
			lots.find(
				(l) => l.source === source && l.feature_id === feature,
			) as CallerCreditLotRow;
		expect(() =>
			run({
				membership: { tier_id: "sparkle-4", addon_ids: "glow" },
				lots: [
					pick(second, "tier", "visit"),
					pick(first, "tier", "retreat"),
					pick(first, "addon:glow", "visit"),
				],
			}),
		).toThrow(/on different cycles/);
	});

	test("a lot that is not a whole number of the menu's per-unit amount", () => {
		expect(() => run({ lots: [{ ...january, allowance: 3 }] })).toThrow(
			/not a whole number of the menu's 2 per unit/,
		);
	});

	test("every problem is named in one error", () => {
		let message = "";
		try {
			run({
				membership: { tier_id: "sparkle-2", addon_ids: "nope" },
				lots: [{ ...january, feature_id: "massage" }],
			});
		} catch (error) {
			message = (error as Error).message;
		}
		expect(message).toContain('add-on "nope"');
		expect(message).toContain('feature "massage"');
	});
});

describe("the state it returns is a state atm accepts", () => {
	test("the grants row round-trips through grantsFromRows, and the rows are canonical and JSON-safe", () => {
		const membership = membershipRow();
		const january = only(
			callerGrant({ membership, menu: utcMenu, invoice: IN_1, existing: [] }),
		);
		const imported = grantsStateFromCallerRows({
			membership,
			lots: [january],
			menu: utcMenu,
			now: D("2026-01-20T00:00:00Z"),
		});
		const state: GrantsState = grantsFromRows(imported.rows);
		expect(state).toEqual(imported.state);
		expect(JSON.parse(JSON.stringify(imported.rows))).toEqual(imported.rows);
	});
});

// ---- D12 T2: what the caller does that atm's rules place on their own rows ----------------------------------------

/** A raise from `from` to `to` units of the member's tier, as Stripe bills it at once (`subscription_update`). */
const raiseEvent = ({
	menu,
	membership,
	invoiceId,
	atMs,
	from,
	to,
	cycleEnd,
}: {
	menu: Menu;
	membership: CallerMembershipRow;
	invoiceId: string;
	atMs: number;
	from: number;
	to: number;
	cycleEnd: number;
}) => {
	const key = tierKey(menu, membership.tier_id, membership.interval);
	const line = (quantity: number, sign: number) => ({
		lookupKey: key,
		amount: sign * 1000 * quantity,
		interval: membership.interval,
		quantity,
		proration: true,
		periodStart: atMs,
		periodEnd: cycleEnd,
	});
	return invoicePaid({
		eventId: `evt_${invoiceId}`,
		invoiceId,
		at: atMs,
		subscriptionId: membership.stripe_subscription_id,
		reason: "subscription_update",
		periodStart: atMs,
		periodEnd: atMs,
		lines: [line(from, -1), line(to, 1)],
		metadata: { b4u_school: SCHOOL, family_id: FAMILY },
	});
};

const visitRows = (rows: readonly BillingRow[]) =>
	rows.filter(
		(r) =>
			r.table === "customerEntitlements" &&
			r.data.internal_feature_id === "feat_visit",
	);

describe("D12 T2: a quantity raise mid-cycle is folded into the cycle's row", () => {
	// Sparkle 1 grants 1 visit a unit. The member bought 2, and raised to 3 halfway through January: the caller's prorated
	// raise is ceil(1 x 1 x 1/2) = 1 visit, which is a whole number of units by chance.
	const menu = utcMenu;
	const membership = membershipRow({
		tier_id: "sparkle-1",
		quantity: 3,
		current_period_end: secondsOf(FEB),
	});
	const atTwo = { ...membership, quantity: 2 };
	const january = only(
		callerGrant({ membership: atTwo, menu, invoice: IN_1, existing: [] }),
	);
	const halfway = JAN + (FEB - JAN) / 2;
	const raise = only(
		callerRaise({
			membership,
			menu,
			invoiceId: "in_raise",
			atMs: halfway,
			from: 2,
			to: 3,
			cycleStart: JAN,
			cycleEnd: FEB,
		}),
	);
	const lots = [january, raise];
	const now = D("2026-01-25T00:00:00Z");
	const imported = grantsStateFromCallerRows({ membership, lots, menu, now });

	test("the raise lot is 1 visit, the cycle's lot 2, both to the same end: the case that used to import as quantity 1", () => {
		expect(january.allowance).toBe(2);
		expect(raise.allowance).toBe(1);
		expect(raise.expires_at).toBe(january.expires_at);
		// One whole unit of the menu's 1 a unit: read back from the newest lot, it says quantity 1.
		expect(raise.allowance % 1).toBe(0);
	});

	test("the quantity is the membership's 3, on the state and on the tier's product", () => {
		expect(imported.state.quantity).toBe(3);
		const product = imported.rows.find(
			(r) => r.table === "customerProducts" && r.id === "cp_tier",
		);
		expect(product?.data.quantity).toBe(3);
	});

	test("one row holds the cycle's lot and the raise, in one refill; both invoices are decided", () => {
		const row = only(visitRows(imported.rows));
		expect(row.data.balance).toBe(3);
		expect(row.data.next_reset_at).toBe(FEB);
		expect(imported.rows.filter((r) => r.table === "rollovers")).toEqual([]);
		expect(imported.state.rows.ce_tier_visit_month).toBe(1);
		expect(imported.state.invoices.in_raise?.granted).toEqual([
			expect.objectContaining({ units: 1, epoch: 1 }),
		]);
		expect(imported.state.invoices.in_1?.granted).toEqual([
			expect.objectContaining({ units: 2, epoch: 1 }),
		]);
	});

	test("a later raise from 3 to 4 grants for one unit, not three; the renewal refills 4", () => {
		const store = atmStore(menu, imported.rows);
		const atRaise = D("2026-01-25T18:00:00Z");
		const raised = store.handle(
			raiseEvent({
				menu,
				membership,
				invoiceId: "in_raise_2",
				atMs: atRaise,
				from: 3,
				to: 4,
				cycleEnd: FEB,
			}),
			atRaise,
		);
		expect(raised.refused).toBeUndefined();
		const units = (store.grants.invoices.in_raise_2?.granted ?? []).reduce(
			(sum, g) => sum + g.units,
			0,
		);
		// 21 of January's 31 days left: ceil(1 x 1 x 21/31) = 1. Imported at quantity 1, it would be ceil(3 x 21/31) = 3.
		expect(units).toBe(1);
		expect(store.grants.quantity).toBe(4);
		const four = { ...membership, quantity: 4 };
		store.handle(
			paidEvent({ menu, membership: four, invoice: IN_2 }),
			IN_2.atMs,
		);
		expect(only(visitRows(store.rows)).data.balance).toBe(4);
	});

	test("the plan's example: 10 a unit, raised from 1 to 3 with half the cycle left, is a lot of 10 and imports as 3", () => {
		const tens: Menu = {
			...menu,
			tiers: menu.tiers.map((t) =>
				t.id === "sparkle-1"
					? {
							...t,
							grants: t.grants.map((g) => ({
								...g,
								amount: 10,
								rollover: { max: 10, months: 1 },
							})),
						}
					: t,
			),
		};
		const atOne = { ...membership, quantity: 1 };
		const first = only(
			callerGrant({
				membership: atOne,
				menu: tens,
				invoice: IN_1,
				existing: [],
			}),
		);
		const up = only(
			callerRaise({
				membership,
				menu: tens,
				invoiceId: "in_raise",
				atMs: halfway,
				from: 1,
				to: 3,
				cycleStart: JAN,
				cycleEnd: FEB,
			}),
		);
		expect(up.allowance).toBe(10);
		const result = grantsStateFromCallerRows({
			membership,
			lots: [first, up],
			menu: tens,
			now,
		});
		expect(result.state.quantity).toBe(3);
		expect(only(visitRows(result.rows)).data.balance).toBe(20);
	});

	test("a raise in an earlier cycle is part of that cycle's refill: its leftover is a rollover", () => {
		const february = only(
			callerGrant({ membership, menu, invoice: IN_2, existing: lots }),
		);
		const leftJanuary = { ...january, balance: 1 };
		const result = grantsStateFromCallerRows({
			membership,
			lots: [leftJanuary, raise, february],
			menu,
			now: D("2026-02-20T00:00:00Z"),
		});
		expect(result.state.rows.ce_tier_visit_month).toBe(2);
		expect(result.state.invoices.in_raise?.granted[0]?.epoch).toBe(1);
		expect(result.state.invoices.in_2?.granted[0]?.epoch).toBe(2);
		const rollovers = result.rows.filter((r) => r.table === "rollovers");
		expect(
			rollovers.reduce((sum, r) => sum + (r.data.balance as number), 0),
		).toBe(2);
		expect(only(visitRows(result.rows)).data.balance).toBe(3);
	});
});

describe("D12 T2: admin adjustments, partial refunds and dropped add-ons import", () => {
	const membership = membershipRow({ current_period_end: secondsOf(FEB) });
	const january = only(
		callerGrant({ membership, menu: utcMenu, invoice: IN_1, existing: [] }),
	);
	const now = D("2026-01-25T00:00:00Z");

	test("an adjustment is its own row: ce_adjust_, no refill, no expiry, external_id adjust:<kind>; no invoice record", () => {
		const goodwill = callerAdjust({
			membership,
			key: "k1",
			kind: "goodwill",
			amount: 3,
			atMs: JAN + HOUR_MS,
		});
		const imported = grantsStateFromCallerRows({
			membership,
			lots: [january, goodwill],
			menu: utcMenu,
			now,
		});
		const row = only(
			imported.rows.filter(
				(r) =>
					r.table === "customerEntitlements" && r.id.startsWith("ce_adjust_"),
			),
		);
		expect(row.data).toMatchObject({
			balance: 3,
			next_reset_at: null,
			expires_at: null,
			customer_product_id: null,
			entitlement_id: "ent_gift_visit",
			internal_feature_id: "feat_visit",
			external_id: "adjust:goodwill",
		});
		expect(Object.keys(imported.state.invoices)).toEqual(["in_1"]);
		expect(imported.state.rows[row.id]).toBe(1);
		// It never lapses: a year on it still counts, beside the refilling row's 2 (which lapses only with a cancel).
		const store = atmStore(utcMenu, imported.rows);
		expect(store.avail(D("2027-06-01T00:00:00Z"))).toBe(2 + 3);
		// The renewal leaves it alone.
		store.handle(
			paidEvent({ menu: utcMenu, membership, invoice: IN_2 }),
			IN_2.atMs,
		);
		const after = store
			.rowsOf("customerEntitlements")
			.find((r) => r.id === row.id);
		expect(after?.data.balance).toBe(3);
	});

	test("an adjustment lot with an expiry is refused: the row never lapses", () => {
		expect(() =>
			grantsStateFromCallerRows({
				membership,
				lots: [
					january,
					{
						...callerAdjust({
							membership,
							key: "k1",
							kind: "gift",
							amount: 1,
							atMs: JAN,
						}),
						expires_at: FEB,
					},
				],
				menu: utcMenu,
				now,
			}),
		).toThrow(/an adjustment row never lapses/);
	});

	test("a refund of one invoice in a row with several: accepted, that invoice taken back, the balance is the lots'", () => {
		const leftJanuary = { ...january, balance: 0, removed_at: FEB - HOUR_MS };
		const february = only(
			callerGrant({
				membership,
				menu: utcMenu,
				invoice: IN_2,
				existing: [january],
			}),
		);
		const imported = grantsStateFromCallerRows({
			membership: membershipRow(),
			lots: [leftJanuary, february],
			menu: utcMenu,
			now: D("2026-02-20T00:00:00Z"),
		});
		expect(imported.state.invoices.in_1?.removed).toBe(true);
		expect(imported.state.invoices.in_2?.removed).toBe(false);
		expect(
			atmStore(utcMenu, imported.rows).avail(D("2026-02-20T00:00:00Z")),
		).toBe(callerAvail([leftJanuary, february], D("2026-02-20T00:00:00Z")));
	});

	test("an invoice with some lots taken back and others not is recorded as taken back", () => {
		const withGlow = membershipRow({
			addon_ids: "glow",
			current_period_end: secondsOf(FEB),
		});
		const lots = callerGrant({
			membership: withGlow,
			menu: utcMenu,
			invoice: IN_1,
			existing: [],
		}).map((lot) =>
			lot.source === "tier"
				? { ...lot, balance: 0, removed_at: JAN + HOUR_MS }
				: lot,
		);
		const imported = grantsStateFromCallerRows({
			membership: withGlow,
			lots,
			menu: utcMenu,
			now,
		});
		expect(imported.state.invoices.in_1?.removed).toBe(true);
		expect(atmStore(utcMenu, imported.rows).avail(now)).toBe(
			callerAvail(lots, now),
		);
	});

	test("a dropped add-on's lots are a retired row that lapses where they do", () => {
		const withGlow = membershipRow({
			addon_ids: "glow",
			current_period_end: secondsOf(FEB),
		});
		const lots = callerGrant({
			membership: withGlow,
			menu: utcMenu,
			invoice: IN_1,
			existing: [],
		});
		const glowLot = lots.find(
			(l) => l.source === "addon:glow",
		) as CallerCreditLotRow;
		const imported = grantsStateFromCallerRows({
			membership: membershipRow({ current_period_end: secondsOf(FEB) }),
			lots,
			menu: utcMenu,
			now,
		});
		const row = imported.rows.find((r) => r.id === "ce_addon_glow_visit_month");
		expect(row?.data).toMatchObject({
			balance: 1,
			next_reset_at: null,
			expires_at: glowLot.expires_at,
		});
		expect(imported.state.retired).toEqual({ ce_addon_glow_visit_month: 1 });
		expect(imported.state.rows.ce_addon_glow_visit_month).toBeUndefined();
		expect(imported.state.addonIds).toEqual([]);
		const store = atmStore(utcMenu, imported.rows);
		for (const at of [now, (glowLot.expires_at as number) + 1])
			expect(store.avail(at)).toBe(callerAvail(lots, at));
		// The renewal refills the tier, not the dropped add-on.
		store.handle(
			paidEvent({
				menu: utcMenu,
				membership: membershipRow(),
				invoice: IN_2,
			}),
			IN_2.atMs,
		);
		expect(store.grants.retired).toEqual({ ce_addon_glow_visit_month: 1 });
		expect(
			store.rowsOf("customerEntitlements").find((r) => r.id === row?.id)?.data
				.balance,
		).toBe(1);
	});

	test("the member's menu version is kept", () => {
		const imported = grantsStateFromCallerRows({
			membership: membershipRow({ menu_version: 7 }),
			lots: [january],
			menu: utcMenu,
			now,
		});
		expect(imported.state.menuVersion).toBe("7");
		expect(grantsFromRows(imported.rows).menuVersion).toBe("7");
	});
});

// ---- D12 T3: opening events --------------------------------------------------------------------------------------

describe("D12 T3: the import's opening events replay to the imported rows, and the handler's later events follow on", () => {
	// The mid-cycle member, with a goodwill adjustment and a raise folded in: January's lot has 1 of 2 left, February's
	// lot 2 of 2, a raise in February adds 1, and an admin gave 3 visits that never lapse. It is the 25th of February.
	const membership = membershipRow({ quantity: 2 });
	const atOne = { ...membership, quantity: 1 };
	const januaryLot = {
		...only(
			callerGrant({
				membership: atOne,
				menu: utcMenu,
				invoice: IN_1,
				existing: [],
			}),
		),
		balance: 1,
	};
	const februaryLot = only(
		callerGrant({
			membership: atOne,
			menu: utcMenu,
			invoice: IN_2,
			existing: [januaryLot],
		}),
	);
	const raised = callerRaise({
		membership,
		menu: utcMenu,
		invoiceId: "in_raise",
		atMs: D("2026-02-20T18:00:00Z"),
		from: 1,
		to: 2,
		cycleStart: FEB,
		cycleEnd: MAR,
	});
	const goodwill = callerAdjust({
		membership,
		key: "k1",
		kind: "goodwill",
		amount: 3,
		atMs: D("2026-02-21T00:00:00Z"),
	});
	const lots = [januaryLot, februaryLot, ...raised, goodwill];
	const now = D("2026-02-25T12:00:00Z");
	const importId = deterministicUlid({
		timeMs: now,
		revision: 0,
		seed: "import-1",
	});
	const imported = grantsStateFromCallerRows({
		membership,
		lots,
		menu: utcMenu,
		now,
		importId,
		policyVersion: 1,
	});
	const catalog = menuCatalogRows({ menu: utcMenu, school: SCHOOL });
	const engineOnly = (rows: readonly BillingRow[]) =>
		rows.filter((r) => r.table !== "atm_grants");
	const replayedRows = (events: readonly AtmEvent[], asOf: number) => {
		const replay = replayEvents({ events, catalog, asOf: isoInstant(asOf) });
		const state = replay.snapshot.states[HOLDER];
		return {
			replay,
			rows: state ? rowsFromState(state as never) : [],
		};
	};

	test("the opening events are valid credit.granted events, caused by the import, at revision 0 to 1", () => {
		expect(imported.revision).toBe(1);
		expect(imported.events.length).toBeGreaterThan(0);
		for (const event of imported.events) {
			expect(validateEvent(event)).toMatchObject({ ok: true });
			// The caller's own command, not a handler decision: a stored-inputs replay carries it.
			const command = (event.payload as { command: { commandId: string } })
				.command;
			expect(command.commandId).toBe(`import:${importId}`);
			expect(HANDLER_COMMAND.test(command.commandId)).toBe(false);
			expect(event.event_type).toBe("credit.granted");
			expect(event.cause).toBe(importId);
			expect(event.key).toBe(HOLDER);
			expect(event.labels).toMatchObject({
				menu_version: "3",
				policy_version: "1",
				mapping: "import/caller-rows",
			});
		}
		// One per plan the credits came from: the tier and the adjustment.
		expect(imported.events.map((e) => e.labels.plan).sort()).toEqual([
			"adjust",
			"sparkle-2@v3",
		]);
		// The same import gives the same events.
		expect(
			grantsStateFromCallerRows({
				membership,
				lots,
				menu: utcMenu,
				now,
				importId,
				policyVersion: 1,
			}).events,
		).toEqual(imported.events);
	});

	test("a log of the opening events replays to exactly the imported rows and balances", () => {
		const { replay, rows } = replayedRows(imported.events, now);
		expect(rows).toEqual(engineOnly(imported.rows));
		expect(replay.balances).toEqual([
			{
				holder: HOLDER,
				feature: "visit",
				avail: callerAvail(lots, now),
				held: 0,
			},
		]);
		const members = membersOf(imported.events, new Date(now), { catalog });
		expect(members.ok).toBe(true);
		if (members.ok)
			expect(members.members[HOLDER]?.features.visit?.available).toBe(
				callerAvail(lots, now),
			);
	});

	test("opening events, then the handler's renewal and a refund, replay to the handler's rows", () => {
		const store = atmStore(utcMenu, imported.rows, {
			[paymentIntentOf("in_2")]: "in_2",
		});
		const later: AtmEvent[] = [];
		const renewal = store.handle(
			paidEvent({ menu: utcMenu, membership, invoice: IN_3 }),
			IN_3.atMs,
		);
		later.push(...renewal.events);
		const refundAt = IN_3.atMs + HOUR_MS;
		const refunded = store.handle(
			chargeRefunded({
				eventId: "evt_refund_in_2",
				chargeId: "ch_in_2",
				invoiceId: "in_2",
				amount: 26000,
				chargeAmount: 26000,
				at: refundAt,
			}),
			refundAt,
		);
		expect(refunded.refused).toBeUndefined();
		later.push(...refunded.events);
		const asOf = D("2026-03-20T00:00:00Z");
		const log = [...imported.events, ...later];
		const { replay, rows } = replayedRows(log, asOf);
		expect(rows).toEqual(engineOnly(store.rows));
		expect(replay.balances[0]?.avail).toBe(store.avail(asOf));
		const members = membersOf(log, new Date(asOf), { catalog });
		expect(members.ok).toBe(true);
		if (members.ok)
			expect(members.members[HOLDER]?.features.visit?.available).toBe(
				store.avail(asOf),
			);
	});

	test("a money-only log before the import, then the opening events and the handler's events, replays", () => {
		// atm booked the member's money before the import (the caller granted the credits): the log holds payments and no
		// subject. The money names no engine command, so the replay steps past it to the opening events.
		const native = atmStore(utcMenu, []);
		const before: AtmEvent[] = [];
		for (const invoice of [IN_1, IN_2])
			before.push(
				...native.handle(
					paidEvent({ menu: utcMenu, membership: atOne, invoice }),
					invoice.atMs,
				).events,
			);
		const money = before.filter(
			(e) => (e.payload as { command?: unknown }).command === undefined,
		);
		expect(money.map((e) => e.event_type)).toContain("payment.succeeded");
		expect(
			replayedRows(money, now).replay.snapshot.states[HOLDER],
		).toBeUndefined();

		const store = atmStore(utcMenu, imported.rows);
		const later = store.handle(
			paidEvent({ menu: utcMenu, membership, invoice: IN_3 }),
			IN_3.atMs,
		).events;
		const asOf = D("2026-03-20T00:00:00Z");
		const log = [...money, ...imported.events, ...later];
		const { replay, rows } = replayedRows(log, asOf);
		expect(rows).toEqual(engineOnly(store.rows));
		expect(replay.balances[0]?.avail).toBe(store.avail(asOf));
		const members = membersOf(log, new Date(asOf), { catalog });
		expect(members.ok).toBe(true);
		if (members.ok)
			expect(members.members[HOLDER]?.features.visit?.available).toBe(
				store.avail(asOf),
			);
	});

	test("a member whose lots have all lapsed opens with a plan.changed: the subject exists, with nothing in it", () => {
		const lapsedNow = D("2026-06-01T00:00:00Z");
		const canceled = membershipRow({
			status: "canceled",
			current_period_end: secondsOf(MAR),
		});
		const result = grantsStateFromCallerRows({
			membership: canceled,
			lots: [januaryLot, februaryLot],
			menu: utcMenu,
			now: lapsedNow,
		});
		expect(result.events.map((e) => e.event_type)).toEqual(["plan.changed"]);
		const { replay, rows } = replayedRows(result.events, lapsedNow);
		expect(rows).toEqual(engineOnly(result.rows));
		expect(replay.balances[0]?.avail ?? 0).toBe(0);
	});

	test("a member with no lots has no subject yet: no opening events", () => {
		const result = grantsStateFromCallerRows({
			membership,
			lots: [],
			menu: utcMenu,
			now,
		});
		expect(result.events).toEqual([]);
		expect(result.revision).toBe(0);
	});
});
