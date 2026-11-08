import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { trifoldLookupKey } from "../../../catalog/trifold/check.ts";
import { HANDLER_DDL } from "../../../packages/atm/src/cloud.ts";
import { invoicePaid } from "../../../packages/atm/src/scenario/stripe-events.ts";
import { PUBLISHED } from "../src/billing/plans";
import { signStripePayload } from "../src/billing/stripe-signature";
import { schoolHintOf } from "../src/billing/webhook";
import { durableSqlDatabase, splitStatements } from "../src/do-sql";
import worker from "../src/index";
import {
	applyBillingEvent,
	migrateOrg,
	ORG_MIGRATIONS,
	OrgDO,
	shipBooks,
} from "../src/org-do";
import { durableState, fakeEnv, memoryR2Binding } from "./fakes";

const API = "staging-api.trifold.app";
const SECRET = "whsec_test_books";
const T0 = Date.parse("2026-11-08T15:00:00Z");
const T1 = Date.parse("2026-12-08T15:00:00Z");
const ACCOUNT = "tfa_0123456789abcdef0123456789abcdef";

/** A recorded-shape invoice.paid for Starter, monthly, as Stripe sends it after a Trifold checkout (test mode). */
const starterPaid = (school = "tf-std", eventId = "evt_books_1") => {
	const org = school === "tf-std" ? "std" : "np";
	const lookupKey = trifoldLookupKey(org, "starter", "month");
	const amount = PUBLISHED.schools[school]?.menu.tiers.find(
		(tier) => tier.id === "starter",
	)?.prices[0]?.amount as number;
	const event = invoicePaid({
		eventId,
		invoiceId: `in_${eventId}`,
		at: T0,
		subscriptionId: "sub_books_1",
		reason: "subscription_create",
		periodStart: T0,
		periodEnd: T1,
		lines: [{ lookupKey, amount, interval: "month" }],
		metadata: {
			b4u_school: school,
			family_id: ACCOUNT,
			tier_id: "starter",
			interval: "month",
		},
	});
	event.livemode = false;
	// Lines name their price by id: the one the publish made for this lookup key.
	for (const line of event.data.object.lines.data)
		line.pricing.price_details.price = PUBLISHED.schools[school]?.priceIds[
			lookupKey
		] as string;
	return JSON.stringify(event);
};

const handlerDb = () => {
	const raw = new Database(":memory:");
	const state = durableState(raw);
	migrateOrg(state);
	return { raw, state, db: durableSqlDatabase(state.storage) };
};

const count = (raw: Database, sql: string) =>
	(raw.query(sql).get() as { n: number }).n;

describe("the Durable Object SQL adapter", () => {
	test("splits HANDLER_DDL into single statements, dropping comments that hold semicolons", () => {
		const statements = splitStatements(HANDLER_DDL);
		expect(statements.length).toBeGreaterThan(5);
		for (const statement of statements) {
			expect(statement).not.toContain("--");
			expect(statement.endsWith(";")).toBe(false);
		}
		expect(splitStatements("SELECT ';'; -- a; b\nSELECT 2")).toEqual([
			"SELECT ';'",
			"SELECT 2",
		]);
	});

	test("the migration runs HANDLER_DDL one statement at a time, and a second wake changes nothing", () => {
		const { raw, state } = handlerDb();
		const tables = (
			raw
				.query("SELECT name FROM sqlite_master WHERE type = 'table'")
				.all() as { name: string }[]
		).map((row) => row.name);
		expect(tables).toEqual(
			expect.arrayContaining([
				"atm_event_claims",
				"ledger_outbox",
				"atm_event_inputs",
			]),
		);
		expect(migrateOrg(state)).toBe(ORG_MIGRATIONS.length);
	});

	test("run() counts the rows the statement changed, from SELECT changes()", () => {
		const { db } = handlerDb();
		db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
		expect(db.run("INSERT INTO t (v) VALUES (?), (?)", ["a", "b"])).toEqual({
			changes: 2,
		});
		expect(db.run("UPDATE t SET v = ? WHERE v = ?", ["c", "zzz"])).toEqual({
			changes: 0,
		});
	});
});

describe("Trifold's books: tfd's handler in the trifold DO", () => {
	test("a golden invoice.paid is applied once: a redelivery is a duplicate and the outbox does not grow", () => {
		const { raw, db } = handlerDb();
		const payload = starterPaid();
		const first = applyBillingEvent({
			db,
			payload,
			schoolHint: "tf-std",
			env: "test",
			nowMs: () => T0 + 5000,
		});
		expect(first.school).toBe("tf-std");
		expect(first.handler.status).toBe(200);
		expect(first.handler.body.outcome).toBe("applied");
		const outbox = count(raw, "SELECT COUNT(*) AS n FROM ledger_outbox");
		expect(outbox).toBeGreaterThan(0);
		const events = (
			raw.query("SELECT body FROM ledger_outbox ORDER BY id").all() as {
				body: string;
			}[]
		).map(
			(row) =>
				JSON.parse(row.body) as {
					event_type: string;
					school: string;
					postings?: { account: string; amount: string }[];
				},
		);
		// Starter's two monthly grants (events, credits), the $29 payment and the MRR change, all in tf-std's books.
		expect(events.map((event) => event.event_type).sort()).toEqual([
			"credit.granted",
			"credit.granted",
			"mrr.changed",
			"payment.succeeded",
		]);
		expect(events.every((event) => event.school === "tf-std")).toBe(true);
		expect(
			events.find((event) => event.event_type === "payment.succeeded")
				?.postings,
		).toEqual([
			{ account: "assets:stripe", amount: "29.00", commodity: "USD" },
			{
				account: "income:billing:membership:starter",
				amount: "-29.00",
				commodity: "USD",
			},
		] as never);
		expect(
			count(raw, "SELECT COUNT(*) AS n FROM atm_event_inputs"),
		).toBeGreaterThan(0);

		const again = applyBillingEvent({
			db,
			payload,
			schoolHint: "tf-std",
			env: "test",
			nowMs: () => T0 + 60_000,
		});
		expect(again.handler.status).toBe(200);
		expect(again.handler.body.outcome).toBe("duplicate");
		expect(count(raw, "SELECT COUNT(*) AS n FROM ledger_outbox")).toBe(outbox);
		expect(
			count(
				raw,
				"SELECT COUNT(*) AS n FROM atm_event_claims WHERE state = 'done'",
			),
		).toBe(1);
	});

	test("an event without a school hint finds its school; a live-mode event is refused on the test books", () => {
		const { db } = handlerDb();
		const np = applyBillingEvent({
			db,
			payload: starterPaid("tf-np", "evt_np"),
			schoolHint: null,
			env: "test",
			nowMs: () => T0 + 5000,
		});
		expect(np.school).toBe("tf-np");
		expect(np.handler.body.outcome).toBe("applied");
		const live = JSON.parse(starterPaid("tf-std", "evt_live"));
		live.livemode = true;
		const refused = applyBillingEvent({
			db,
			payload: JSON.stringify(live),
			schoolHint: "tf-std",
			env: "test",
			nowMs: () => T0 + 5000,
		});
		expect(refused.handler.status).toBe(422);
		expect(refused.handler.body.outcome).toBe("livemode_mismatch");
	});

	test("shipping puts the outbox under schools/tf-std/ and marks it shipped; a second ship puts nothing", async () => {
		const { raw, db } = handlerDb();
		applyBillingEvent({
			db,
			payload: starterPaid(),
			schoolHint: "tf-std",
			env: "test",
			nowMs: () => T0 + 5000,
		});
		const books = memoryR2Binding();
		const shipped = await shipBooks({
			db,
			books: books.bucket,
			schools: ["tf-std"],
			nowMs: () => T0 + 10_000,
		});
		const keys = [...books.objects.keys()];
		expect(keys.length).toBe(shipped.batches);
		expect(shipped.events).toBe(
			count(raw, "SELECT COUNT(*) AS n FROM ledger_outbox"),
		);
		for (const key of keys)
			expect(key).toMatch(
				/^schools\/tf-std\/events\/date=2026-11-08\/batch-[0-9A-Z]+-[0-9a-f]{16}\.jsonl$/,
			);
		expect(books.text(keys[0] as string)).toContain("payment.succeeded");
		expect(
			count(
				raw,
				"SELECT COUNT(*) AS n FROM ledger_outbox WHERE shipped_at IS NULL",
			),
		).toBe(0);
		const second = await shipBooks({
			db,
			books: books.bucket,
			schools: ["tf-std"],
			nowMs: () => T0 + 20_000,
		});
		expect(second).toEqual({ batches: 0, events: 0, conflicts: 0 });
	});
});

/** The Worker and a real OrgDO over bun:sqlite and an in-memory books bucket, wired like the staging bindings. */
const wired = (secret: string | null = SECRET) => {
	const books = memoryR2Binding();
	const raw = new Database(":memory:");
	const state = durableState(raw);
	const env = {
		...fakeEnv(),
		BOOKS: books.bucket as never,
		STRIPE_BILLING_WEBHOOK_SECRET: secret ?? undefined,
	};
	const object = new OrgDO(state, env);
	env.ORG = {
		idFromName: (name) => name,
		get: (id) => {
			if (id !== "trifold") throw new Error(`unexpected DO ${String(id)}`);
			return { fetch: (request) => object.fetch(request) };
		},
	};
	const deliver = async (payload: string, header?: string): Promise<Response> =>
		worker.fetch(
			new Request(`https://${API}/webhooks/billing`, {
				method: "POST",
				body: payload,
				headers: {
					"Stripe-Signature":
						header ??
						(await signStripePayload({
							payload,
							secret: SECRET,
							timestampSeconds: Math.floor(Date.now() / 1000),
						})),
				},
			}),
			env,
		);
	return { env, raw, books, state, deliver };
};

describe("POST /webhooks/billing", () => {
	test("a signed invoice.paid is applied in the trifold DO and shipped before the 200; a redelivery answers duplicate", async () => {
		const { raw, books, deliver } = wired();
		const payload = starterPaid();
		const response = await deliver(payload);
		expect(response.status).toBe(200);
		const body = (await response.json()) as Record<string, unknown>;
		expect(body.outcome).toBe("applied");
		expect(body.school).toBe("tf-std");
		expect((body.shipped as { events: number }).events).toBeGreaterThan(0);
		expect(
			[...books.objects.keys()].every((key) =>
				key.startsWith("schools/tf-std/events/"),
			),
		).toBe(true);
		const objects = books.objects.size;

		const again = await deliver(payload);
		expect(again.status).toBe(200);
		expect(((await again.json()) as { outcome: string }).outcome).toBe(
			"duplicate",
		);
		expect(books.objects.size).toBe(objects);
		expect(count(raw, "SELECT COUNT(*) AS n FROM atm_event_claims")).toBe(1);
	});

	test("a bad, stale or foreign signature is a 400 and never reaches the DO", async () => {
		const { raw, deliver } = wired();
		const payload = starterPaid();
		const stale = await signStripePayload({
			payload,
			secret: SECRET,
			timestampSeconds: Math.floor(Date.now() / 1000) - 301,
		});
		const foreign = await signStripePayload({
			payload,
			secret: "whsec_someone_else",
			timestampSeconds: Math.floor(Date.now() / 1000),
		});
		for (const header of ["t=1,v1=00", stale, foreign, "garbage"]) {
			const response = await deliver(payload, header);
			expect(response.status).toBe(400);
		}
		expect(count(raw, "SELECT COUNT(*) AS n FROM atm_event_claims")).toBe(0);
	});

	test("a failing DO is a 503, so Stripe retries; no secret configured is a 503 too", async () => {
		const { env } = wired();
		env.ORG = {
			idFromName: (name) => name,
			get: () => ({
				fetch: async () => {
					throw new Error("storage down");
				},
			}),
		};
		const payload = starterPaid();
		const header = await signStripePayload({
			payload,
			secret: SECRET,
			timestampSeconds: Math.floor(Date.now() / 1000),
		});
		const response = await worker.fetch(
			new Request(`https://${API}/webhooks/billing`, {
				method: "POST",
				body: payload,
				headers: { "Stripe-Signature": header },
			}),
			env,
		);
		expect(response.status).toBe(503);
		const unset = wired(null);
		expect((await unset.deliver(payload)).status).toBe(503);
	});

	test("a live-mode event on staging is answered 200 and not applied", async () => {
		const { raw, deliver } = wired();
		const live = JSON.parse(starterPaid());
		live.livemode = true;
		const response = await deliver(JSON.stringify(live));
		expect(response.status).toBe(200);
		expect(((await response.json()) as { reason: string }).reason).toBe(
			"other_mode",
		);
		expect(count(raw, "SELECT COUNT(*) AS n FROM atm_event_claims")).toBe(0);
	});

	test("a failed ship still answers 200 (the event is committed) and sets an alarm to ship again", async () => {
		const { state, books, deliver } = wired();
		const put = books.bucket.put;
		books.bucket.put = async () => {
			throw new Error("R2 down");
		};
		const response = await deliver(starterPaid());
		expect(response.status).toBe(200);
		expect(
			((await response.json()) as { shipped: unknown }).shipped,
		).toBeNull();
		expect(state.alarms.length).toBe(1);
		books.bucket.put = put;
	});

	test("the school hint comes from the subscription's metadata on the invoice, or the subscription itself", () => {
		expect(schoolHintOf(JSON.parse(starterPaid("tf-np")))).toBe("tf-np");
		expect(
			schoolHintOf({
				data: { object: { metadata: { b4u_school: "tf-std" } } },
			}),
		).toBe("tf-std");
		expect(
			schoolHintOf({ data: { object: { metadata: { b4u_school: "other" } } } }),
		).toBeNull();
	});
});
