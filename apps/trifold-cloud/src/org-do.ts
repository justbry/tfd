/**
 * One Durable Object per organization (PLAN.md section 3.1). Its SQLite is the tfd handler's database. Trifold's own
 * books live in the one named `trifold` (`TRIFOLD_BOOKS`): the billing webhook hands it each verified Stripe event, it
 * runs tfd's `handleStripeWebhook` and ships the outbox to `schools/<school>/` in the books bucket. The Connect inbox
 * and its alarm for customer orgs arrive in M3.
 */
import {
	HANDLER_DDL,
	handleStripeWebhook,
	R2BindingStore,
	type R2BucketBinding,
	type SqlDatabase,
	shipOutbox,
	signStripePayload,
	type WebhookResponse,
} from "../../../packages/atm/src/cloud.ts";
import { invoicePaidFee } from "./billing/fees";
import { SCHOOL_IDS, webhookContext } from "./billing/plans";
import { type DurableSqlStorage, durableSqlDatabase } from "./do-sql";
import type { CloudEnv } from "./env";

/** The Durable Object that keeps Trifold's own books (its subscriptions, PLAN.md section 5). */
export const TRIFOLD_BOOKS = "trifold";
/** A failed ship is tried again after this long. */
const SHIP_RETRY_MS = 60_000;

export type DurableObjectState = {
	storage: DurableSqlStorage & {
		setAlarm?(scheduledTime: number): Promise<void>;
	};
	blockConcurrencyWhile<T>(work: () => Promise<T>): Promise<T>;
};

/**
 * Numbered schema steps, applied in order, each in its own transaction, the first time a DO wakes after a deploy.
 * A step may hold several statements. Never edit a released step; add the next one.
 */
export const ORG_MIGRATIONS: readonly string[] = [
	// 1: nothing yet besides the version table itself (created by the runner).
	"SELECT 1",
	// 2: tfd's handler tables: rows, claims, payment index, ledger outbox, stored inputs (all IF NOT EXISTS).
	HANDLER_DDL,
];

export const migrateOrg = (state: DurableObjectState): number => {
	const { sql } = state.storage;
	const db = durableSqlDatabase(state.storage);
	sql.exec(
		"CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)",
	);
	const [row] = sql.exec("SELECT version FROM schema_version").toArray();
	let version = typeof row?.version === "number" ? row.version : 0;
	if (row === undefined)
		sql.exec("INSERT INTO schema_version (version) VALUES (0)");
	for (; version < ORG_MIGRATIONS.length; version += 1) {
		const step = ORG_MIGRATIONS[version] as string;
		state.storage.transactionSync(() => {
			db.exec(step);
			sql.exec("UPDATE schema_version SET version = ?", version + 1);
		});
	}
	// HANDLER_DDL is tfd's, and grows additively (all IF NOT EXISTS): step 2 ran the release it was on, so apply the
	// current one on every wake, or a DO made before a tfd upgrade lacks the new tables and every delivery throws.
	state.storage.transactionSync(() => db.exec(HANDLER_DDL));
	return version;
};

export type BillingApplied = {
	school: string | null;
	handler: WebhookResponse;
	shipped: { batches: number; events: number; conflicts: number } | null;
};

/**
 * Runs one verified Stripe event through tfd's handler. The Worker checked Stripe's signature; the event is re-signed
 * here with a one-off secret, so the handler's own check (and its 300 s window) passes for exactly this body. An event
 * that names its school (`b4u_school`) goes to that school; one that does not (an `invoice_payment.paid`, a refund) is
 * tried against each Trifold school until one does not answer `school_mismatch`. `fee` is the Stripe fee the caller read
 * for an `invoice.paid` (`invoicePaidFee`), handed to the handler as its `paymentFee`; the handler stores it with the
 * input and books it as `expenses:billing:stripe-fees`.
 */
export const applyBillingEvent = (input: {
	db: SqlDatabase;
	payload: string;
	schoolHint: string | null;
	env: "test" | "live";
	nowMs: () => number;
	fee?: number;
}): { school: string | null; handler: WebhookResponse } => {
	const schools =
		input.schoolHint && SCHOOL_IDS.includes(input.schoolHint)
			? [input.schoolHint]
			: SCHOOL_IDS;
	let last: { school: string | null; handler: WebhookResponse } | null = null;
	for (const schoolId of schools) {
		const secret = crypto.randomUUID();
		const handler = handleStripeWebhook(
			{
				db: input.db,
				secret,
				schoolId,
				env: input.env,
				nowMs: input.nowMs,
				workerId: "trifold-cloud",
				context: webhookContext,
				warn: (line) => console.warn(line),
				...(input.fee === undefined ? {} : { paymentFee: () => input.fee }),
			},
			{
				payload: input.payload,
				signatureHeader: signStripePayload({
					payload: input.payload,
					secret,
					timestampSeconds: Math.floor(input.nowMs() / 1000),
				}),
			},
		);
		last = { school: schoolId, handler };
		if (handler.body.outcome !== "school_mismatch") return last;
	}
	return (
		last ?? {
			school: null,
			handler: { status: 422, body: { outcome: "unknown_school" } },
		}
	);
};

/** Ships every unshipped outbox row of `schools` to the books bucket, `schools/<school>/events/…`. */
export const shipBooks = async (input: {
	db: SqlDatabase;
	books: R2BucketBinding;
	schools: readonly string[];
	nowMs: () => number;
}) => {
	const store = new R2BindingStore(input.books);
	const total = { batches: 0, events: 0, conflicts: 0 };
	for (const school of input.schools) {
		const result = await shipOutbox({
			db: input.db,
			store,
			school,
			nowMs: input.nowMs,
		});
		total.batches += result.batches.length;
		total.events += result.shipped;
		total.conflicts += result.conflicts.length;
		for (const conflict of result.conflicts)
			console.error(
				`ship ${school}: conflict at ${conflict.key}: ${conflict.message}`,
			);
	}
	return total;
};

const unshippedSchools = (db: SqlDatabase): string[] =>
	db
		.all<{ school_id: string }>(
			"SELECT DISTINCT school_id FROM ledger_outbox WHERE shipped_at IS NULL",
		)
		.map((row) => row.school_id);

export class OrgDO {
	private version = 0;
	private readonly db: SqlDatabase;

	constructor(
		private readonly state: DurableObjectState,
		private readonly env: CloudEnv,
		/** Stripe's API, for the fee lookup; tests pass a fake. */
		private readonly fetcher: typeof fetch = fetch,
	) {
		this.db = durableSqlDatabase(state.storage);
		void state.blockConcurrencyWhile(async () => {
			this.version = migrateOrg(state);
		});
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === "/billing/stripe" && request.method === "POST")
			return this.billing(request);
		if (url.pathname === "/billing/status" && request.method === "GET")
			return Response.json(this.status());
		return Response.json({ schemaVersion: this.version });
	}

	/**
	 * Reads the Stripe fee of an `invoice.paid`, applies the event, then ships. Answers once the handler's transaction is
	 * committed; a failed ship retries by alarm. A fee not known yet is a 503 before the handler runs, so Stripe sends the
	 * event again and the payment is booked once, with its fee (the handler never books a fee later).
	 */
	private async billing(request: Request): Promise<Response> {
		const payload = await request.text();
		const fee = await invoicePaidFee(JSON.parse(payload), {
			key: this.env.STRIPE_SECRET_KEY,
			fetcher: this.fetcher,
		});
		if (fee && !fee.ok) {
			console.error(`billing: fee ${fee.reason}: ${fee.message}`);
			return Response.json(
				{
					school: null,
					handler: {
						status: 503,
						body: { outcome: "fee_pending", reason: fee.reason },
					},
					shipped: null,
				},
				{ status: 503 },
			);
		}
		const applied = applyBillingEvent({
			db: this.db,
			payload,
			schoolHint: request.headers.get("X-School-Hint"),
			env: this.env.ENVIRONMENT === "production" ? "live" : "test",
			nowMs: Date.now,
			...(fee ? { fee: fee.fee } : {}),
		});
		let shipped: BillingApplied["shipped"] = null;
		if (applied.handler.status === 200) shipped = await this.ship();
		const result: BillingApplied = { ...applied, shipped };
		return Response.json(result, { status: applied.handler.status });
	}

	private async ship(): Promise<BillingApplied["shipped"]> {
		try {
			const shipped = await shipBooks({
				db: this.db,
				books: this.env.BOOKS as unknown as R2BucketBinding,
				schools: unshippedSchools(this.db),
				nowMs: Date.now,
			});
			return shipped;
		} catch (error) {
			console.error(
				`ship failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			await this.retryShip();
			return null;
		}
	}

	private async retryShip(): Promise<void> {
		await this.state.storage.setAlarm?.(Date.now() + SHIP_RETRY_MS);
	}

	async alarm(): Promise<void> {
		await this.ship();
	}

	/** Counts for operators and the end-to-end check: claims by outcome, outbox rows shipped and not. No personal data. */
	private status() {
		return {
			schemaVersion: this.version,
			claims: this.db.all(
				"SELECT state, outcome, COUNT(*) AS count FROM atm_event_claims GROUP BY state, outcome",
			),
			outbox: this.db.all(
				"SELECT school_id, shipped_at IS NOT NULL AS shipped, COUNT(*) AS count FROM ledger_outbox GROUP BY school_id, shipped",
			),
			batches: this.db.all(
				"SELECT DISTINCT batch_key FROM ledger_outbox WHERE batch_key IS NOT NULL ORDER BY batch_key",
			),
		};
	}
}
