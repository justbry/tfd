/**
 * D12 T5: a member keeps the menu version they bought. The handler asks `deps.context` per holder, passing the version the
 * holder's grants state records, so a renewal is granted from the member's own menu even after the school publishes a
 * new one. A context that sets `pinMenuVersion` has a new member's version recorded at their first grant.
 */
import { describe, expect, test } from "bun:test";
import { grantsStateFromCallerRows } from "../src/billing/adopt.js";
import { menuCatalogRows } from "../src/billing/grants.js";
import { DEFAULT_POLICY } from "../src/billing/policy.js";
import { grantsFromRows } from "../src/billing/rows.js";
import { menuLineItems } from "../src/billing/stripe-menu.js";
import { appendToOutbox } from "../src/ledger/outbox.js";
import { simulateFromInputs } from "../src/ledger/simulate-inputs.js";
import type {
	BillingRow,
	Menu,
	WebhookContext,
	WebhookContextSubject,
} from "../src/types.js";
import {
	FAMILY,
	GROSS,
	harness,
	menu,
	paid,
	SCHOOL,
	T0,
	T1,
	tierKey,
} from "./handler-harness.js";
import { logOf, readStored } from "./simulate-inputs-world.js";
import { invoicePaid, priceIdOf } from "./stripe-events.js";

const T2 = Date.parse("2026-03-15T18:00:00Z");
const SUBJECT = `${SCHOOL}|live|family:${FAMILY}`;

/** Version 2 of the menu: the same tier at the same price grants 3 visits a month, not 2. */
const menuV2: Menu = {
	...menu,
	tiers: menu.tiers.map((tier) =>
		tier.id === "sparkle-2"
			? {
					...tier,
					grants: tier.grants.map((grant) => ({
						...grant,
						amount: 3,
						rollover: { max: 3, months: 1 },
					})),
				}
			: tier,
	),
};
const MENUS: Record<string, Menu> = { "1": menu, "2": menuV2 };

const contextOf = (version: string, pin: boolean): WebhookContext => {
	const served = MENUS[version] as Menu;
	return {
		menu: served,
		menuVersion: version,
		...(pin ? { pinMenuVersion: true } : {}),
		policy: DEFAULT_POLICY,
		policyVersion: 1,
		catalog: menuCatalogRows({ menu: served, school: SCHOOL }),
		priceIds: Object.fromEntries(
			[...menuLineItems(SCHOOL, served).keys()].map((key) => [
				key,
				priceIdOf(key),
			]),
		),
	};
};

const renewal = (invoiceId = "in_2", family = FAMILY) =>
	invoicePaid({
		eventId: `evt_${invoiceId}`,
		invoiceId,
		at: T1,
		subscriptionId: family === FAMILY ? "sub_1" : `sub_${family}`,
		reason: "subscription_cycle",
		periodStart: T1,
		periodEnd: T2,
		lines: [{ lookupKey: tierKey(), amount: GROSS, interval: "month" }],
		metadata: { b4u_school: SCHOOL, family_id: family },
	});

/** A school serving each holder the menu of the version its state records, else the current one. */
const school = ({ pin }: { pin: boolean }) => {
	const h = harness();
	const subjects: (WebhookContextSubject | undefined)[] = [];
	const served = { current: "1" };
	h.deps.context = (_school, subject) => {
		subjects.push(subject);
		return contextOf(subject?.menuVersion ?? served.current, pin);
	};
	const rowsOf = (key: string): BillingRow[] =>
		(
			h.raw
				.query(
					`SELECT table_name, row_id, data FROM atm_rows WHERE subject_key = ?`,
				)
				.all(key) as { table_name: string; row_id: string; data: string }[]
		).map((row) => ({
			table: row.table_name,
			id: row.row_id,
			data: JSON.parse(row.data),
		})) as BillingRow[];
	const visits = (key: string) =>
		rowsOf(key).find((r) => r.id === "ce_tier_visit_month")?.data.balance;
	return { ...h, subjects, served, rowsOf, visits };
};

/** Imports the member on version 1 (one lot of January's 2 visits) into the handler's tables, opening events in the outbox. */
const importInto = (s: ReturnType<typeof school>) => {
	const imported = grantsStateFromCallerRows({
		membership: {
			id: "mem_1",
			school_id: SCHOOL,
			family_id: FAMILY,
			profile_id: null,
			tier_id: "sparkle-2",
			interval: "month",
			addon_ids: "",
			menu_version: 1,
			stripe_customer_id: "cus_1",
			quantity: 1,
			stripe_subscription_id: "sub_1",
			status: "active",
			current_period_end: Math.floor(T1 / 1000),
			cancel_at_period_end: 0,
			revision: 1,
			stripe_event_at: Math.floor(T0 / 1000),
			created_at: Math.floor(T0 / 1000),
			updated_at: Math.floor(T0 / 1000),
		},
		lots: [
			{
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
				expires_at: Date.parse("2026-03-15T18:00:00Z"),
				created_at: T0 + 10_000,
			},
		],
		menu: { ...menu, timeZone: "UTC" },
		now: T0 + 60_000,
	});
	s.db.transaction(() => {
		for (const row of imported.rows)
			s.db.run(
				`INSERT INTO atm_rows (subject_key, table_name, row_id, data) VALUES (?, ?, ?, ?)`,
				[SUBJECT, row.table, row.id, JSON.stringify(row.data)],
			);
		s.db.run(`INSERT INTO atm_subjects (subject_key, revision) VALUES (?, ?)`, [
			SUBJECT,
			imported.revision,
		]);
		appendToOutbox(s.db, imported.events, "live");
	});
	return imported;
};

describe("D12 T5: the handler decides each member on their own menu version", () => {
	test("the context is subjects per holder, with the version the holder's state records", () => {
		const s = school({ pin: true });
		expect(s.deliver(paid()).body.outcome).toBe("applied");
		expect(s.subjects[0]).toEqual({ subjectKey: SUBJECT, menuVersion: null });
		expect(grantsFromRows(s.rowsOf(SUBJECT)).menuVersion).toBe("1");
		s.served.current = "2";
		expect(s.deliver(renewal(), T1).body.outcome).toBe("applied");
		expect(s.subjects[1]).toEqual({ subjectKey: SUBJECT, menuVersion: "1" });
	});

	test("a renewal after the school publishes version 2 is granted from the member's version 1", () => {
		const s = school({ pin: true });
		s.deliver(paid());
		s.served.current = "2";
		s.deliver(renewal(), T1);
		expect(s.visits(SUBJECT)).toBe(2);
		const renewed = s
			.outbox()
			.filter(
				(e) =>
					e.event_type === "credit.granted" &&
					e.event_time >= new Date(T1).toISOString(),
			);
		expect(renewed.length).toBeGreaterThan(0);
		for (const event of renewed) expect(event.labels.menu_version).toBe("1");
		// A member who joins after the change is on version 2, and stays there.
		s.deliver(
			invoicePaid({
				eventId: "evt_new",
				invoiceId: "in_new",
				at: T1,
				subscriptionId: "sub_new",
				reason: "subscription_create",
				periodStart: T1,
				periodEnd: T2,
				lines: [{ lookupKey: tierKey(), amount: GROSS, interval: "month" }],
				metadata: { b4u_school: SCHOOL, family_id: "fam_new" },
			}),
			T1,
		);
		const newcomer = `${SCHOOL}|live|family:fam_new`;
		expect(s.visits(newcomer)).toBe(3);
		expect(grantsFromRows(s.rowsOf(newcomer)).menuVersion).toBe("2");
	});

	test("an imported member is kept on their version without pinMenuVersion", () => {
		const s = school({ pin: false });
		s.served.current = "2";
		importInto(s);
		expect(s.deliver(renewal(), T1).body.outcome).toBe("applied");
		expect(s.subjects[0]).toEqual({ subjectKey: SUBJECT, menuVersion: "1" });
		expect(s.visits(SUBJECT)).toBe(2);
		expect(grantsFromRows(s.rowsOf(SUBJECT)).menuVersion).toBe("1");
	});

	test("an imported member's log, opening events first, replays from the stored inputs with nothing left out", async () => {
		const s = school({ pin: false });
		importInto(s);
		expect(s.deliver(renewal(), T1).body.outcome).toBe("applied");
		const sim = simulateFromInputs({
			events: logOf(s),
			inputs: await readStored(s, "live", SCHOOL),
			env: "live",
			school: SCHOOL,
			candidate: {},
		});
		expect(sim.baseline.identical).toBe(true);
		expect(sim.notReplayable.items).toEqual([]);
	});

	test("a pinned member's stored inputs replay as they were decided, each with its own version's menu", async () => {
		const s = school({ pin: true });
		s.deliver(paid());
		s.served.current = "2";
		s.deliver(renewal(), T1);
		const sim = simulateFromInputs({
			events: logOf(s),
			inputs: await readStored(s, "live", SCHOOL),
			env: "live",
			school: SCHOOL,
			candidate: {},
		});
		expect(sim.baseline.identical).toBe(true);
		expect(sim.notReplayable.items).toEqual([]);
	});

	test("without pinMenuVersion a new member's state records no version, as before", () => {
		const s = school({ pin: false });
		s.deliver(paid());
		expect(grantsFromRows(s.rowsOf(SUBJECT)).menuVersion).toBeUndefined();
		expect(
			s.rowsOf(SUBJECT).find((r) => r.table === "atm_grants")?.data,
		).not.toHaveProperty("menuVersion");
		s.served.current = "2";
		s.deliver(renewal(), T1);
		expect(s.subjects[1]).toEqual({ subjectKey: SUBJECT, menuVersion: null });
		expect(s.visits(SUBJECT)).toBe(3);
	});

	test("a handler with the single-menu context it always had still works", () => {
		const h = harness();
		expect(h.deliver(paid()).body.outcome).toBe("applied");
	});
});
