/**
 * Seeding the handler's claim and index tables for a school whose credits come in by import (D12 T6). The handler learns
 * an invoice's subject from its `invoice.paid` and a payment's invoice from its `invoice_payment.paid`; an invoice paid
 * before the import never reached it, so a later refund or dispute of it would wait for ever (409 `unmatched_payment`,
 * or `unmatched_invoice` for a late `invoice_payment.paid`). And a Stripe event the caller already handled, delivered
 * again, must be a `duplicate`, not decided a second time.
 *
 * Runs in the caller's transaction (the import's). Every insert is `ON CONFLICT DO NOTHING`, so running it again writes
 * nothing; an index row that already names another subject or invoice throws instead, since the import and the handler
 * then disagree about whose money it was.
 */
import { resolveEnv } from "../billing/env.js";
import { subjectKey } from "../billing/rows.js";
import type {
	SeedHandlerIndexesInput,
	SeedHandlerIndexesResult,
	SqlDatabase,
} from "../types.js";
import { assertCurrentSchema } from "./schema.js";

/** Who seeded a claim, in `claimed_by`; its `outcome` is `imported`. */
const SEEDED_BY = "import";
const SEEDED_OUTCOME = "imported";

/**
 * Seeds `atm_event_claims` (each id in `eventIds`, as done), `atm_invoice_index` (each invoice to its holder's subject)
 * and `atm_payment_index` (each of an invoice's payment intent and charge ids to the invoice), all in `env` (default
 * `live`, as the handler's `deps.env`). Returns how many rows each table gained. Throws, before writing, on an empty id;
 * and on an index row that already names another subject or invoice.
 */
export const seedHandlerIndexes = (
	db: SqlDatabase,
	input: SeedHandlerIndexesInput,
): SeedHandlerIndexesResult => {
	assertCurrentSchema(db);
	const env = resolveEnv(input.env);
	for (const eventId of input.eventIds)
		if (typeof eventId !== "string" || eventId === "")
			throw new Error("a seeded Stripe event id must be a non-empty string");
	for (const invoice of input.invoices) {
		if (typeof invoice.invoiceId !== "string" || invoice.invoiceId === "")
			throw new Error("a seeded invoice needs its Stripe id");
		for (const ref of invoice.paymentRefs ?? [])
			if (typeof ref !== "string" || ref === "")
				throw new Error(
					`invoice ${invoice.invoiceId} names an empty payment ref`,
				);
	}

	const result: SeedHandlerIndexesResult = {
		claims: 0,
		invoices: 0,
		payments: 0,
	};
	for (const eventId of input.eventIds)
		result.claims += db.run(
			`INSERT INTO atm_event_claims (env, event_id, state, claimed_at, claimed_by, done_at, outcome) VALUES (?, ?, 'done', ?, ?, ?, ?) ON CONFLICT (env, event_id) DO NOTHING`,
			[env, eventId, input.at, SEEDED_BY, input.at, SEEDED_OUTCOME],
		).changes;

	for (const invoice of input.invoices) {
		const key = subjectKey({
			orgId: invoice.holder.orgId,
			env,
			customerId: invoice.holder.customerId,
			entityId: null,
		});
		const added = db.run(
			`INSERT INTO atm_invoice_index (env, invoice_id, subject_key) VALUES (?, ?, ?) ON CONFLICT (env, invoice_id) DO NOTHING`,
			[env, invoice.invoiceId, key],
		).changes;
		if (added === 0) {
			const [held] = db.all<{ subject_key: string }>(
				`SELECT subject_key FROM atm_invoice_index WHERE env = ? AND invoice_id = ?`,
				[env, invoice.invoiceId],
			);
			if (held && held.subject_key !== key)
				throw new Error(
					`invoice ${invoice.invoiceId} is indexed to ${held.subject_key}, not ${key}`,
				);
		}
		result.invoices += added;
		for (const ref of new Set(invoice.paymentRefs ?? [])) {
			const linked = db.run(
				`INSERT INTO atm_payment_index (env, payment_ref, invoice_id) VALUES (?, ?, ?) ON CONFLICT (env, payment_ref) DO NOTHING`,
				[env, ref, invoice.invoiceId],
			).changes;
			if (linked === 0) {
				const [held] = db.all<{ invoice_id: string }>(
					`SELECT invoice_id FROM atm_payment_index WHERE env = ? AND payment_ref = ?`,
					[env, ref],
				);
				if (held && held.invoice_id !== invoice.invoiceId)
					throw new Error(
						`payment ${ref} is indexed to invoice ${held.invoice_id}, not ${invoice.invoiceId}`,
					);
			}
			result.payments += linked;
		}
	}
	return result;
};
