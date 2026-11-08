/**
 * Seeding the handler's claims and indexes for an imported school (D12 T6): a Stripe event the caller already handled is
 * a `duplicate`, and a refund of an invoice paid before the import finds its holder instead of waiting for ever.
 */
import { describe, expect, test } from "bun:test";
import { seedHandlerIndexes } from "../src/handler/seed.js";
import { paymentIntentOf } from "../src/scenario/stripe-events.js";
import {
	FAMILY,
	GROSS,
	HOUR,
	harness,
	paid,
	REFUNDED,
	refund,
	SCHOOL,
	T0,
} from "./handler-harness.js";

const HOLDER = { orgId: SCHOOL, customerId: `family:${FAMILY}` };
const PRE_IMPORT = {
	invoiceId: "in_1",
	holder: HOLDER,
	paymentRefs: [paymentIntentOf("in_1"), "ch_in_1"],
};

const count = (h: ReturnType<typeof harness>, table: string) =>
	(h.raw.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

/**
 * A school the handler never served: the subject's rows came in by import (here, copied from a handler that did serve
 * it), and no claim or index row exists.
 */
const imported = () => {
	const before = harness();
	expect(before.deliver(paid("in_1")).status).toBe(200);
	const after = harness();
	for (const table of ["atm_subjects", "atm_rows"]) {
		const rows = before.raw.query(`SELECT * FROM ${table}`).all() as Record<
			string,
			string | number
		>[];
		for (const row of rows) {
			const columns = Object.keys(row);
			after.raw
				.query(
					`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
				)
				.run(...columns.map((column) => row[column] as string | number));
		}
	}
	return after;
};

describe("seedHandlerIndexes", () => {
	test("it writes one claim, one invoice and its payments; a second run writes nothing", () => {
		const h = imported();
		const input = {
			at: T0 + 2 * HOUR,
			eventIds: ["evt_in_1", "evt_old_sub"],
			invoices: [PRE_IMPORT],
		};
		expect(seedHandlerIndexes(h.db, input)).toEqual({
			claims: 2,
			invoices: 1,
			payments: 2,
		});
		expect(seedHandlerIndexes(h.db, input)).toEqual({
			claims: 0,
			invoices: 0,
			payments: 0,
		});
		expect(count(h, "atm_event_claims")).toBe(2);
		expect(count(h, "atm_invoice_index")).toBe(1);
		expect(count(h, "atm_payment_index")).toBe(2);
		expect(
			h.raw
				.query(
					`SELECT env, state, claimed_by, outcome FROM atm_event_claims WHERE event_id = 'evt_in_1'`,
				)
				.get(),
		).toEqual({
			env: "live",
			state: "done",
			claimed_by: "import",
			outcome: "imported",
		});
		expect(
			h.raw.query(`SELECT subject_key FROM atm_invoice_index`).get(),
		).toEqual({ subject_key: `${SCHOOL}|live|family:${FAMILY}` });
	});

	test("a refund of a pre-import invoice waits unseeded, and is decided once seeded", () => {
		const h = imported();
		const waiting = h.deliver(refund(REFUNDED), T0 + HOUR);
		expect([waiting.status, waiting.body.outcome]).toEqual([
			409,
			"unmatched_payment",
		]);
		seedHandlerIndexes(h.db, {
			at: T0 + 2 * HOUR,
			eventIds: ["evt_in_1"],
			invoices: [PRE_IMPORT],
		});
		const decided = h.deliver(refund(REFUNDED), T0 + 3 * HOUR);
		expect([decided.status, decided.body.outcome]).toEqual([200, "applied"]);
		const refunded = h
			.outbox()
			.filter((event) => event.event_type === "payment.refunded");
		expect(refunded).toHaveLength(1);
		expect(refunded[0]?.key).toBe(`family:${FAMILY}`);
		// a full refund takes the invoice's credits back too
		const full = imported();
		seedHandlerIndexes(full.db, {
			at: T0 + 2 * HOUR,
			eventIds: [],
			invoices: [PRE_IMPORT],
		});
		expect(
			full.deliver(refund(GROSS, { eventId: "evt_re_full" }), T0 + 3 * HOUR)
				.status,
		).toBe(200);
		expect(
			full.outbox().some((event) => event.event_type.startsWith("credit.")),
		).toBe(true);
	});

	test("a seeded event id delivered again is a duplicate, and decides nothing", () => {
		const h = imported();
		seedHandlerIndexes(h.db, {
			at: T0 + 2 * HOUR,
			eventIds: ["evt_in_1"],
			invoices: [PRE_IMPORT],
		});
		const again = h.deliver(paid("in_1"), T0 + 3 * HOUR);
		expect([again.status, again.body.outcome]).toEqual([200, "duplicate"]);
		expect(h.outbox()).toEqual([]);
	});

	test("an index that already names another holder or invoice throws; empty ids throw before writing", () => {
		const h = imported();
		seedHandlerIndexes(h.db, { at: T0, eventIds: [], invoices: [PRE_IMPORT] });
		expect(() =>
			seedHandlerIndexes(h.db, {
				at: T0,
				eventIds: [],
				invoices: [
					{ ...PRE_IMPORT, holder: { ...HOLDER, customerId: "family:other" } },
				],
			}),
		).toThrow(/indexed to/);
		expect(() =>
			seedHandlerIndexes(h.db, {
				at: T0,
				eventIds: [],
				invoices: [
					{ invoiceId: "in_2", holder: HOLDER, paymentRefs: ["ch_in_1"] },
				],
			}),
		).toThrow(/payment ch_in_1 is indexed to invoice in_1/);
		const empty = harness();
		expect(() =>
			seedHandlerIndexes(empty.db, {
				at: T0,
				eventIds: ["evt_1", ""],
				invoices: [],
			}),
		).toThrow();
		expect(count(empty, "atm_event_claims")).toBe(0);
	});

	test("the test env keeps its own rows", () => {
		const h = harness();
		seedHandlerIndexes(h.db, {
			env: "test",
			at: T0,
			eventIds: ["evt_in_1"],
			invoices: [PRE_IMPORT],
		});
		expect(
			h.raw.query(`SELECT DISTINCT env FROM atm_event_claims`).all(),
		).toEqual([{ env: "test" }]);
		expect(
			h.raw.query(`SELECT subject_key FROM atm_invoice_index`).get(),
		).toEqual({ subject_key: `${SCHOOL}|test|family:${FAMILY}` });
	});
});
