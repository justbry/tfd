/**
 * A cycle that ended unpaid (plan §13 item 7, D12 decision 4; `policy.rulesVersion` 3): `unpaidCycleToCommands` dates the
 * cycle's refilling rows so `recordLapse` books them at the cycle's end plus the grant's rollover months; a renewal paid
 * afterwards undoes the dating before the lapse and finds the credits lapsed after it. The bundles `credits-unpaid-lapse`
 * and `credits-unpaid-late-payment` hold the same story with the books; this holds the cases around it.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { SubjectState } from "@autumn/balance-engine";
import {
	addZonedMonths,
	EMPTY_GRANTS_STATE,
	type GrantCommand,
	type GrantsState,
	invoiceToCommands,
	menuCatalogRows,
	subscriptionEndedToCommands,
	unpaidCycleToCommands,
} from "../src/billing/grants.js";
import { DEFAULT_POLICY } from "../src/billing/policy.js";
import {
	applyRowChanges,
	rowsFromState,
	subjectFromRows,
} from "../src/billing/rows.js";
import type {
	BillingInvoice,
	BillingPolicy,
	Menu,
	SubscriptionFact,
} from "../src/billing/types.js";
import { lapseUnpaidCycle } from "../src/billing/unpaid.js";
import { runOnState, toCatalog } from "../src/ledger/run.js";
import { createStore } from "../src/scenario/store.js";
import { tierInvoice } from "./credits-engine-world.js";
import { FAMILY, menu, SCHOOL } from "./handler-harness.js";

const dir = `${import.meta.dir}/../fixtures/billing/grants`;
const load = <T>(name: string): T =>
	JSON.parse(readFileSync(`${dir}/${name}.json`, "utf8")) as T;
const D = (iso: string) => Date.parse(iso);
const HOLDER = `family:${FAMILY}`;
const V = { menuVersion: 3, policyVersion: 1 };
const RULES_3: BillingPolicy = { ...DEFAULT_POLICY, rulesVersion: 3 };
const RULES_2: BillingPolicy = { ...DEFAULT_POLICY, rulesVersion: 2 };
const ROW = "ce_tier_visit_month";
/** The create invoice's cycle ends 15 February 18:00 UTC. */
const FEB15 = D("2026-02-15T18:00:00Z");
const catalogRows = menuCatalogRows({ menu, school: SCHOOL });

/** A menu whose sparkle-2 grants carry nothing over: its unpaid row lapses at the cycle's end. */
const flatMenu: Menu = {
	...menu,
	tiers: menu.tiers.map((tier) =>
		tier.id === "sparkle-2"
			? {
					...tier,
					grants: tier.grants.map(({ rollover: _rollover, ...grant }) => grant),
				}
			: tier,
	),
};

const world = (policy: BillingPolicy, ofMenu: Menu = menu) => {
	const catalogOf = toCatalog(
		menuCatalogRows({ menu: ofMenu, school: SCHOOL }),
	);
	let engine: SubjectState | null = null;
	let grants: GrantsState = EMPTY_GRANTS_STATE;
	const run = (commands: GrantCommand[]) => {
		for (const command of commands)
			engine = runOnState({ state: engine, catalog: catalogOf, command }).state;
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
					catalog: menuCatalogRows({ menu: ofMenu, school: SCHOOL }),
				});
	return {
		get engine() {
			return engine as SubjectState;
		},
		get grants() {
			return grants;
		},
		invoice(invoice: BillingInvoice) {
			const result = invoiceToCommands({
				invoice,
				menu: ofMenu,
				policy,
				state: grants,
				subject: subject(),
				now: invoice.paidAt,
				...V,
			});
			grants = result.state;
			run(result.commands);
			return result;
		},
		unpaid(cycleEnd: number, now: number) {
			const result = unpaidCycleToCommands({
				cycleEnd,
				menu: ofMenu,
				policy,
				state: grants,
				subject: subject(),
				now,
				...V,
			});
			grants = result.state;
			run(result.commands);
			return result;
		},
		end(fact: SubscriptionFact, now: number) {
			const result = subscriptionEndedToCommands({
				subscription: fact,
				menu: ofMenu,
				policy,
				state: grants,
				subject: subject(),
				now,
				...V,
			});
			grants = result.state;
			run(result.commands);
			return result;
		},
		row: () => engine?.customerEntitlements.find((r) => r.id === ROW),
	};
};

const created = (policy: BillingPolicy, ofMenu: Menu = menu) => {
	const w = world(policy, ofMenu);
	w.invoice(load<BillingInvoice>("inv-create-s2"));
	return w;
};

describe("the command", () => {
	test("rules versions 1 and 2 and a policy without one date nothing", () => {
		for (const policy of [DEFAULT_POLICY, RULES_2]) {
			const w = created(policy);
			const result = w.unpaid(FEB15, FEB15 + 1);
			expect(result.skipped).toBe("rules_version");
			expect(result.commands).toEqual([]);
			expect(w.row()?.expires_at).toBeNull();
		}
	});

	test("dates the row at the cycle's end plus the rollover month in the menu's zone: Denver, across the clocks going forward", () => {
		const w = created(RULES_3);
		const before = w.grants;
		const result = w.unpaid(FEB15, FEB15 + 3_600_000);
		expect(result.skipped).toBeNull();
		expect(result.dated).toEqual([ROW]);
		// 15 February 11:00 MST + 1 month = 15 March 11:00 MDT: 17:00 UTC, an hour before the UTC month
		const expiry = D("2026-03-15T17:00:00Z");
		expect(expiry).toBe(addZonedMonths(FEB15, 1, "America/Denver"));
		expect(w.row()?.expires_at).toBe(expiry);
		// the grants state does not change: the dated row is the record
		expect(w.grants).toBe(before);
		// the refill date stays, so a renewal paid late still resets the row
		expect(w.row()?.next_reset_at).toBe(FEB15);
		expect(w.row()?.balance).toBe(2);
	});

	test("a grant with no rollover lapses at the cycle's end itself", () => {
		const w = created(RULES_3, flatMenu);
		w.unpaid(FEB15, FEB15 + 1);
		expect(w.row()?.expires_at).toBe(FEB15);
	});

	test("is one command per cycle: a second call, another cycle, a cycle not over and a canceled subscription date nothing", () => {
		const w = created(RULES_3);
		expect(w.unpaid(FEB15, FEB15 - 1).skipped).toBe("not_over");
		expect(w.unpaid(FEB15 + 1, FEB15 + 2).skipped).toBe("other_cycle");
		expect(w.unpaid(FEB15, FEB15 + 1).skipped).toBeNull();
		const again = w.unpaid(FEB15, FEB15 + 2);
		expect(again.skipped).toBe("already_dated");
		expect(again.commands).toEqual([]);
		expect(again.state).toBe(w.grants);

		const canceled = created(RULES_3);
		canceled.end(
			{
				id: "sub_1",
				status: "canceled",
				at: FEB15 + 10,
				source: { eventId: "evt_del", mapping: "m", stripeApiVersion: "v" },
			} as unknown as SubscriptionFact,
			FEB15 + 10,
		);
		expect(canceled.unpaid(FEB15, FEB15 + 20).skipped).toBe("ended");
	});

	test("a member who never paid gives nothing", () => {
		expect(world(RULES_3).unpaid(FEB15, FEB15 + 1).skipped).toBe(
			"no_subscription",
		);
	});
});

describe("a renewal paid after the cycle ended unpaid", () => {
	const feb = () => load<BillingInvoice>("inv-cycle-s2-feb");

	test("before the lapse date it takes the dating back and grants as any renewal: the 2 left roll over", () => {
		const late = created(RULES_3);
		late.unpaid(FEB15, FEB15 + 3_600_000);
		const paid = late.invoice({ ...feb(), paidAt: D("2026-02-20T12:00:00Z") });
		expect(paid.lapsed).toBeUndefined();
		const normal = created(RULES_3);
		normal.invoice({ ...feb(), paidAt: D("2026-02-20T12:00:00Z") });
		expect(late.row()?.expires_at).toBeNull();
		// the row and its rollovers are what a renewal with no unpaid cycle makes (the rollover's id carries its command's step)
		expect(JSON.stringify(late.engine.customerEntitlements)).toBe(
			JSON.stringify(normal.engine.customerEntitlements),
		);
		const rolled = (w: ReturnType<typeof world>) =>
			w.engine.rollovers.map((r) => [r.balance, r.expires_at]);
		expect(rolled(late)).toEqual(rolled(normal));
		expect(rolled(late)).toEqual([[2, D("2026-03-15T17:00:00Z")]]);
		expect(JSON.stringify(late.grants)).toBe(JSON.stringify(normal.grants));
		expect(paid.commands.length).toBeGreaterThan(0);
	});

	test("after the lapse date the lapsed credits are emptied, not rolled over, and the cycle's allowance is granted", () => {
		const w = created(RULES_3);
		w.unpaid(FEB15, FEB15 + 3_600_000);
		const lateAt = D("2026-03-20T12:00:00Z");
		const paid = w.invoice({ ...feb(), paidAt: lateAt });
		// the handler is told which lapsed credits the renewal emptied, to book them if the cron has not
		expect(paid.lapsed).toEqual([
			{
				rowId: ROW,
				feature: "visit",
				balance: 2,
				expiresAt: D("2026-03-15T17:00:00Z"),
			},
		]);
		expect(w.row()?.expires_at).toBeNull();
		expect(w.row()?.balance).toBe(2);
		expect(w.engine.rollovers).toEqual([]);
	});

	test("a renewal that is not a subscription cycle leaves the dating alone", () => {
		const w = created(RULES_3);
		w.unpaid(FEB15, FEB15 + 3_600_000);
		w.invoice(load<BillingInvoice>("inv-gift-sessions"));
		expect(w.row()?.expires_at).toBe(D("2026-03-15T17:00:00Z"));
	});

	test("without the subject (a caller that does not pass it) the dating stays: nothing is undone blind", () => {
		const w = created(RULES_3);
		w.unpaid(FEB15, FEB15 + 3_600_000);
		const result = invoiceToCommands({
			invoice: { ...feb(), paidAt: D("2026-02-20T12:00:00Z") },
			menu,
			policy: RULES_3,
			state: w.grants,
			now: D("2026-02-20T12:00:00Z"),
			...V,
		});
		const ops = result.commands.flatMap(
			(command) =>
				(command as unknown as { ops?: { set?: Record<string, unknown> }[] })
					.ops ?? [],
		);
		expect(ops.some((op) => op.set && "expires_at" in op.set)).toBe(false);
	});
});

describe("the handler and the lapse job on stored rows", () => {
	const at = (iso: string) => D(iso);
	const stored = () => {
		const store = createStore({
			menu,
			school: SCHOOL,
			family: FAMILY,
			policy: RULES_3,
		});
		const cycle = (start: string, end: string) => ({
			start: at(start),
			end: at(end),
		});
		const JAN = cycle("2026-01-15T18:00:00Z", "2026-02-15T18:00:00Z");
		const FEB = cycle("2026-02-15T18:00:00Z", "2026-03-15T18:00:00Z");
		const MAR = cycle("2026-03-15T18:00:00Z", "2026-04-15T18:00:00Z");
		store.handle(
			tierInvoice({
				id: "in_1",
				at: JAN.start,
				reason: "subscription_create",
				cycle: JAN,
				tier: "sparkle-2",
				amount: 26_000,
			}),
			JAN.start,
			{ fee: 784 },
		);
		store.handle(
			tierInvoice({
				id: "in_2",
				at: FEB.start,
				reason: "subscription_cycle",
				cycle: JAN,
				next: FEB,
				tier: "sparkle-2",
				amount: 26_000,
			}),
			FEB.start,
			{ fee: 784 },
		);
		const job = (now: number) => {
			const result = lapseUnpaidCycle({
				holder: { orgId: SCHOOL, customerId: HOLDER },
				cycleEnd: FEB.end,
				menu,
				menuVersion: 1,
				policy: RULES_3,
				policyVersion: 1,
				rows: store.rows,
				revision: store.revision,
				catalog: catalogRows,
				now,
			});
			return result;
		};
		const late = (now: number) =>
			store.handle(
				tierInvoice({
					id: "in_3",
					at: now,
					reason: "subscription_cycle",
					cycle: FEB,
					next: MAR,
					tier: "sparkle-2",
					amount: 26_000,
				}),
				now,
				{ fee: 784 },
			);
		return { store, job, late, FEB, MAR };
	};

	test("a member who spent all their credits has nothing to date", () => {
		const { store, job, FEB } = stored();
		store.spend(2, FEB.start + 1000);
		store.lapse("visit", FEB.end + 3_600_000);
		store.spend(2, FEB.start + 2000);
		expect(job(FEB.end + 3_600_000).skipped).toBe("nothing_held");
	});

	test("the lapse job's write dates the row once; the same call again is a replay", () => {
		const { store, job, FEB } = stored();
		const first = job(FEB.end + 3_600_000);
		expect(first.skipped).toBeNull();
		expect(first.events.map((e) => e.event_type)).toEqual([
			"credit.expiration_changed",
		]);
		expect(first.rowChanges?.expectedRevision).toBe(store.revision);
		expect(first.rowChanges).not.toBeNull();
		const rows = applyRowChanges({
			rows: store.rows,
			revision: store.revision,
			changes: first.rowChanges as NonNullable<typeof first.rowChanges>,
		});
		const again = lapseUnpaidCycle({
			holder: { orgId: SCHOOL, customerId: HOLDER },
			cycleEnd: FEB.end,
			menu,
			menuVersion: 1,
			policy: RULES_3,
			policyVersion: 1,
			rows: rows.rows,
			revision: rows.revision,
			catalog: catalogRows,
			now: FEB.end + 7_200_000,
		});
		expect(again.replayed).toBe(true);
		expect(again.rowChanges).toBeNull();
		expect(again.events).toEqual([]);
	});

	test("a renewal paid after the lapse, before the cron ran, books the lapse itself under the cron's idem, once", () => {
		const { store, job, late, FEB } = stored();
		// 16 March: the lapse job's cron books the February rollover, then the unpaid cycle is dated
		store.lapse("visit", FEB.end + 3_600_000);
		const first = job(FEB.end + 3_600_000);
		store.rows.splice(
			0,
			store.rows.length,
			...applyRowChanges({
				rows: store.rows,
				revision: store.revision,
				changes: first.rowChanges as NonNullable<typeof first.rowChanges>,
			}).rows,
		);
		// 20 April: past the 15 April lapse date; the cron has not run since
		const lateAt = D("2026-04-20T12:00:00Z");
		const result = late(lateAt);
		expect(result.refused).toBeUndefined();
		const expired = () =>
			store.events
				.filter((e) => e.event_type === "credit.expired")
				.map((e) => [e.event_time, e.postings[0]?.amount]);
		expect(expired()).toEqual([
			["2026-03-15T17:00:00Z", "-2"],
			["2026-04-15T18:00:00Z", "-2"],
		]);
		// the cron after it books nothing more, and nothing was booked as an adjustment
		store.lapse("visit", lateAt + 3_600_000);
		expect(expired()).toHaveLength(2);
		expect(
			store.events.filter((e) => e.event_type === "credit.adjusted"),
		).toEqual([]);
		expect(new Set(store.events.map((e) => e.idem)).size).toBe(
			store.events.length,
		);
		// 2 and 2 granted, the rollover and the lapsed row's 2 expired, the late payment's 2 granted
		expect(store.avail(lateAt + 3_600_000)).toBe(2);
	});
});
