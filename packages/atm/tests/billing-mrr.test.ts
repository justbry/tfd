/**
 * Monthly recurring revenue through the real `handleStripeEvent` (`src/billing/mrr.ts`): an `mrr.changed` after each
 * Stripe fact that moves what a subscription bills a month, with postings in the MRR commodity (whole cents a month) from
 * `mrr:movement:<movement>` to `mrr:recurring:<holder>`, and the same number from the atm fold, hledger and DuckDB.
 *
 * The menu is the SaaS demo's (`fixtures/billing/menu/lumen-notes.json`): solo 1200 a month or 12000 a year, team 1000 a
 * seat a month (3, 5 or 10 seats), support-plus 2900 a month (recurring add-on), api-boost 2500 once.
 */
import { describe, expect, test } from "bun:test";
import { grantsFromRows } from "../src/billing/rows.js";
import {
	addonPriceKey,
	lookupKeyOf,
	tierPriceKey,
} from "../src/billing/stripe-menu.js";
import type { Interval } from "../src/billing/types.js";
import { validateEvent } from "../src/ledger/validate.js";
import { atmChannel } from "../src/scenario/channels/atm.js";
import { duckdbChannel } from "../src/scenario/channels/duckdb.js";
import { hledgerChannel } from "../src/scenario/channels/hledger.js";
import { evaluateKpis, SCHOOL_KPIS } from "../src/scenario/kpis.js";
import { ORGS } from "../src/scenario/orgs.js";
import { createStore } from "../src/scenario/store.js";
import {
	type EventLine,
	invoicePaid,
	subscriptionDeleted,
	subscriptionEvent,
} from "../src/scenario/stripe-events.js";
import type { AtmEvent } from "../src/types.js";

const { menu, id: SCHOOL } = ORGS.saas;
const DAY = 86_400_000;
const T0 = Date.parse("2026-01-10T17:00:00Z");
const MONTH_LATER = Date.parse("2026-02-10T17:00:00Z");
const YEAR_LATER = Date.parse("2027-01-10T17:00:00Z");

const tierKey = (tier: string, interval: Interval, unit: number) =>
	lookupKeyOf(SCHOOL, tierPriceKey(tier, interval), unit, menu.currency);
const addonKey = (
	addon: string,
	every: "month" | "year" | "once",
	unit: number,
) => lookupKeyOf(SCHOOL, addonPriceKey(addon, every), unit, menu.currency);

const SOLO_MONTH = tierKey("solo", "month", 1200);
const SOLO_YEAR = tierKey("solo", "year", 12_000);
const TEAM_MONTH = tierKey("team", "month", 1000);
const SUPPORT = addonKey("support-plus", "month", 2900);
const BOOST = addonKey("api-boost", "once", 2500);

const family = (name = "fam_1") =>
	createStore({
		menu,
		school: SCHOOL,
		family: name,
		commandPrefix: `${name}_`,
	});
type Family = ReturnType<typeof family>;

const invoice = (
	store: Family,
	{
		id,
		at,
		lines,
		reason = "subscription_create",
		currency,
		periodEnd = at + 30 * DAY,
	}: {
		id: string;
		at: number;
		lines: EventLine[];
		reason?:
			| "subscription_create"
			| "subscription_cycle"
			| "subscription_update";
		currency?: string;
		periodEnd?: number;
	},
) => {
	const event = invoicePaid({
		eventId: `evt_${id}`,
		invoiceId: id,
		at,
		subscriptionId: "sub_1",
		reason,
		periodStart: at,
		periodEnd,
		lines,
		metadata: { b4u_school: SCHOOL, family_id: "fam_1" },
		amountPaid: lines.reduce((n, l) => n + l.amount - (l.discount ?? 0), 0),
	});
	if (currency) event.data.object.currency = currency;
	const result = store.handle(event, at, {});
	expect(result.refused).toBeUndefined();
	return result.events;
};

const mrrEvents = (events: readonly AtmEvent[]) =>
	events.filter((event) => event.event_type === "mrr.changed");
const only = (events: readonly AtmEvent[]): AtmEvent => {
	const found = mrrEvents(events);
	expect(found).toHaveLength(1);
	return found[0] as AtmEvent;
};
const heldCents = (store: Family) => grantsFromRows(store.rows).mrr?.cents;

describe("an invoice books what its recurring lines bill a month", () => {
	test("a monthly price is its amount a month: new MRR, postings in whole cents", () => {
		const store = family();
		const event = only(
			invoice(store, {
				id: "in_1",
				at: T0,
				lines: [{ lookupKey: SOLO_MONTH, amount: 1200, interval: "month" }],
			}),
		);
		expect(event.postings).toEqual([
			{
				account: "mrr:recurring:family:fam_1",
				amount: "1200",
				commodity: "MRR",
			},
			{ account: "mrr:movement:new", amount: "-1200", commodity: "MRR" },
		]);
		expect(event.labels).toMatchObject({
			subscription: "sub_1",
			movement: "new",
			mrr: "1200",
		});
		expect(event.idem).toBe("stripe:in_1:mrr");
		expect(event.payload).toMatchObject({
			from: "invoice",
			invoice: "in_1",
			before: 0,
			after: 1200,
		});
		expect(validateEvent(event).errors).toEqual([]);
		expect(heldCents(store)).toBe(1200);
	});

	test("a yearly price is a twelfth, half up: 12000 x 1 / 12 = 1000; 12001 / 12 = 1000.08 -> 1000; 12006 / 12 = 1000.5 -> 1001", () => {
		for (const [amount, cents] of [
			[12_000, 1000],
			[12_001, 1000],
			[12_006, 1001],
		] as const) {
			const store = family();
			const event = only(
				invoice(store, {
					id: "in_1",
					at: T0,
					periodEnd: YEAR_LATER,
					lines: [{ lookupKey: SOLO_YEAR, amount, interval: "year" }],
				}),
			);
			expect(event.payload).toMatchObject({
				after: cents,
				items: [{ interval: "year", months: 12, amount, discount: 0, cents }],
			});
		}
	});

	test("seats multiply: 5 x 1000 a month is 5000", () => {
		const store = family();
		const event = only(
			invoice(store, {
				id: "in_1",
				at: T0,
				lines: [
					{
						lookupKey: TEAM_MONTH,
						amount: 5000,
						interval: "month",
						quantity: 5,
					},
				],
			}),
		);
		expect(event.payload).toMatchObject({
			after: 5000,
			items: [{ quantity: 5, cents: 5000 }],
		});
	});

	test("a recurring add-on adds its price; a one-time one adds nothing", () => {
		const store = family();
		const event = only(
			invoice(store, {
				id: "in_1",
				at: T0,
				lines: [
					{ lookupKey: SOLO_MONTH, amount: 1200, interval: "month" },
					{ lookupKey: SUPPORT, amount: 2900, interval: "month" },
					{ lookupKey: BOOST, amount: 2500, interval: null },
				],
			}),
		);
		expect(event.payload).toMatchObject({ after: 4100 });
		expect((event.payload.items as unknown[]).length).toBe(2);
	});

	test("a free (100%-discounted) subscription adds 0 but is booked: a new event with postings of 0", () => {
		const store = family();
		const events = invoice(store, {
			id: "in_1",
			at: T0,
			lines: [
				{
					lookupKey: SOLO_MONTH,
					amount: 1200,
					interval: "month",
					discount: 1200,
				},
			],
		});
		expect(
			events.some((event) => event.event_type === "payment.succeeded"),
		).toBe(false);
		const event = only(events);
		expect(event.postings.map((posting) => posting.amount)).toEqual(["0", "0"]);
		expect(event.payload).toMatchObject({
			after: 0,
			items: [{ amount: 1200, discount: 1200, cents: 0 }],
		});
		expect(validateEvent(event).errors).toEqual([]);
	});

	test("a renewal at the same price moves nothing; a renewal at a new price moves it", () => {
		const store = family();
		const lines: EventLine[] = [
			{ lookupKey: SOLO_MONTH, amount: 1200, interval: "month" },
		];
		invoice(store, { id: "in_1", at: T0, lines });
		expect(
			mrrEvents(
				invoice(store, {
					id: "in_2",
					at: MONTH_LATER,
					lines,
					reason: "subscription_cycle",
				}),
			),
		).toEqual([]);
		const raised = only(
			invoice(store, {
				id: "in_3",
				at: MONTH_LATER + 30 * DAY,
				reason: "subscription_cycle",
				lines: [
					{
						lookupKey: TEAM_MONTH,
						amount: 3000,
						interval: "month",
						quantity: 3,
					},
				],
			}),
		);
		expect(raised.labels.movement).toBe("expansion");
		expect(raised.payload).toMatchObject({ before: 1200, after: 3000 });
	});

	test("an invoice in another currency books no MRR: its money.skipped marker stands for it, as for the other money KPIs", () => {
		const store = family();
		const events = invoice(store, {
			id: "in_1",
			at: T0,
			currency: "eur",
			lines: [{ lookupKey: SOLO_MONTH, amount: 1200, interval: "month" }],
		});
		expect(events.map((event) => event.event_type)).toContain("money.skipped");
		expect(mrrEvents(events)).toEqual([]);
		expect(heldCents(store)).toBeUndefined();
	});
});

describe("a subscription change moves MRR from when Stripe makes it", () => {
	const teamOf = (seats: number) =>
		[
			{
				lookupKey: TEAM_MONTH,
				amount: 1000 * seats,
				interval: "month",
				quantity: seats,
			},
		] as EventLine[];
	const changed = (
		store: Family,
		at: number,
		items: Parameters<typeof subscriptionEvent>[0]["items"],
		status = "active",
	) => {
		const result = store.handle(
			subscriptionEvent({
				type: "customer.subscription.updated",
				eventId: `evt_su_${at}`,
				subscriptionId: "sub_1",
				status,
				items,
				periodStart: T0,
				periodEnd: MONTH_LATER,
				at,
				metadata: { b4u_school: SCHOOL, family_id: "fam_1" },
			}),
			at,
			{},
		);
		expect(result.refused).toBeUndefined();
		return result.events;
	};

	test("a seat raise is expansion at the change, and its prorated invoice and the renewal move nothing more", () => {
		const store = family();
		invoice(store, { id: "in_1", at: T0, lines: teamOf(3) });
		const at = T0 + 12 * DAY;
		const event = only(
			changed(store, at, [
				{
					lookupKey: TEAM_MONTH,
					interval: "month",
					quantity: 5,
					unitAmount: 1000,
				},
			]),
		);
		expect(event.labels.movement).toBe("expansion");
		expect(event.event_time).toBe(
			new Date(at).toISOString().replace(".000Z", "Z"),
		);
		expect(event.payload).toMatchObject({
			from: "subscription",
			before: 3000,
			after: 5000,
		});
		expect(event.postings[1]).toEqual({
			account: "mrr:movement:expansion",
			amount: "-2000",
			commodity: "MRR",
		});
		// Stripe's proration pair for the raise: the rest of the period, not a price
		const update = invoice(store, {
			id: "in_1_change",
			at,
			reason: "subscription_update",
			periodEnd: MONTH_LATER,
			lines: [
				{
					lookupKey: TEAM_MONTH,
					amount: -1800,
					interval: "month",
					quantity: 3,
					proration: true,
					periodStart: at,
				},
				{
					lookupKey: TEAM_MONTH,
					amount: 3000,
					interval: "month",
					quantity: 5,
					proration: true,
					periodStart: at,
				},
			],
		});
		expect(mrrEvents(update)).toEqual([]);
		expect(
			mrrEvents(
				invoice(store, {
					id: "in_2",
					at: MONTH_LATER,
					reason: "subscription_cycle",
					lines: teamOf(5),
				}),
			),
		).toEqual([]);
		expect(heldCents(store)).toBe(5000);
	});

	test("an upgrade to another price is expansion; a seat cut is contraction; an unchanged item keeps what it was booked at", () => {
		const store = family();
		invoice(store, {
			id: "in_1",
			at: T0,
			lines: [
				{ lookupKey: SOLO_MONTH, amount: 1200, interval: "month" },
				{ lookupKey: SUPPORT, amount: 2900, interval: "month" },
			],
		});
		const up = only(
			changed(store, T0 + DAY, [
				{
					lookupKey: TEAM_MONTH,
					interval: "month",
					quantity: 10,
					unitAmount: 1000,
				},
				{ lookupKey: SUPPORT, interval: "month", unitAmount: 2900 },
			]),
		);
		expect(up.payload).toMatchObject({ before: 4100, after: 12_900 });
		const down = only(
			changed(store, T0 + 2 * DAY, [
				{
					lookupKey: TEAM_MONTH,
					interval: "month",
					quantity: 5,
					unitAmount: 1000,
				},
				{ lookupKey: SUPPORT, interval: "month", unitAmount: 2900 },
			]),
		);
		expect(down.labels.movement).toBe("contraction");
		expect(down.payload).toMatchObject({ before: 12_900, after: 7900 });
	});

	test("a change keeps the discount the last full invoice took: a free subscription stays at 0", () => {
		const store = family();
		invoice(store, {
			id: "in_1",
			at: T0,
			lines: [
				{
					lookupKey: TEAM_MONTH,
					amount: 3000,
					interval: "month",
					quantity: 3,
					discount: 3000,
				},
			],
		});
		expect(
			mrrEvents(
				changed(store, T0 + DAY, [
					{
						lookupKey: TEAM_MONTH,
						interval: "month",
						quantity: 5,
						unitAmount: 1000,
					},
				]),
			),
		).toEqual([]);
		expect(heldCents(store)).toBe(0);
		expect(grantsFromRows(store.rows).mrr?.items[0]).toMatchObject({
			quantity: 5,
			amount: 5000,
			discount: 5000,
			cents: 0,
		});
	});

	test("a late subscription event changes nothing", () => {
		const store = family();
		invoice(store, { id: "in_1", at: T0, lines: teamOf(3) });
		expect(
			mrrEvents(
				changed(store, T0 - DAY, [
					{
						lookupKey: TEAM_MONTH,
						interval: "month",
						quantity: 10,
						unitAmount: 1000,
					},
				]),
			),
		).toEqual([]);
		expect(heldCents(store)).toBe(3000);
	});

	test("a cancellation drops MRR at the period's end, churned, once", () => {
		const store = family();
		invoice(store, { id: "in_1", at: T0, lines: teamOf(3) });
		const ended = store.handle(
			subscriptionDeleted({
				eventId: "evt_sd_1",
				subscriptionId: "sub_1",
				tierId: "team",
				interval: "month",
				periodStart: T0,
				periodEnd: MONTH_LATER,
				at: MONTH_LATER,
			}),
			MONTH_LATER,
			{},
		);
		expect(ended.refused).toBeUndefined();
		const event = only(ended.events);
		expect(event.labels.movement).toBe("churned");
		expect(event.idem).toBe("stripe:sub_1:mrr:ended");
		expect(event.payload).toMatchObject({
			from: "ended",
			before: 3000,
			after: 0,
			ended: true,
			items: [],
		});
		expect(event.postings).toEqual([
			{
				account: "mrr:recurring:family:fam_1",
				amount: "-3000",
				commodity: "MRR",
			},
			{ account: "mrr:movement:churned", amount: "3000", commodity: "MRR" },
		]);
		expect(heldCents(store)).toBe(0);
	});
});

test("the atm fold, hledger and DuckDB reach the same MRR from the postings alone", async () => {
	const one = family("fam_1");
	invoice(one, {
		id: "in_1",
		at: T0,
		lines: [
			{ lookupKey: SOLO_MONTH, amount: 1200, interval: "month" },
			{ lookupKey: SUPPORT, amount: 2900, interval: "month" },
		],
	});
	one.handle(
		subscriptionDeleted({
			eventId: "evt_sd_1",
			subscriptionId: "sub_1",
			tierId: "solo",
			interval: "month",
			periodStart: T0,
			periodEnd: MONTH_LATER,
			at: MONTH_LATER,
		}),
		MONTH_LATER,
		{},
	);
	const two = family("fam_2");
	const yearly = invoicePaid({
		eventId: "evt_in_2",
		invoiceId: "in_2",
		at: T0,
		subscriptionId: "sub_2",
		reason: "subscription_create",
		periodStart: T0,
		periodEnd: YEAR_LATER,
		lines: [{ lookupKey: SOLO_YEAR, amount: 12_000, interval: "year" }],
		metadata: { b4u_school: SCHOOL, family_id: "fam_2" },
	});
	expect(two.handle(yearly, T0, {}).refused).toBeUndefined();
	const events = [...one.events, ...two.events];
	const periods = ["2026-01", "2026-02"];
	const rowsOf = async (channel: typeof hledgerChannel) =>
		evaluateKpis({
			spec: SCHOOL_KPIS,
			base: await channel.base({ events, spec: SCHOOL_KPIS, periods }),
			periods,
		}).filter((row) => row.kpiId.endsWith("mrr"));
	const atm = await rowsOf(atmChannel);
	// January: 1200 + 2900 + 12000 / 12 = 5100. February: fam_1 ended, 1000 left.
	expect(
		atm.filter((row) => row.kpiId === "mrr").map((row) => row.value),
	).toEqual([5100, 1000]);
	expect(
		atm.filter((row) => row.kpiId === "churned_mrr").map((row) => row.value),
	).toEqual([0, 4100]);
	expect(
		atm.filter((row) => row.kpiId === "net_new_mrr").map((row) => row.value),
	).toEqual([5100, -4100]);
	expect(await rowsOf(hledgerChannel)).toEqual(atm);
	expect(await rowsOf(duckdbChannel)).toEqual(atm);
});
