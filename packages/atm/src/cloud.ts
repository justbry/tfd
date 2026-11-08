/**
 * The Worker entry for the write side (plans/trifold-cloud/PLAN.md section 3.1): what a Durable Object needs to run the
 * reference webhook handler over its own SQLite and ship the outbox to an R2 binding, and what a Worker needs to make a
 * membership's Checkout Session. It imports the modules directly, not `index.ts`, which pulls in `FolderStore`
 * (`node:fs`), DuckDB and the CLI's helpers.
 *
 * Ajv is in the bundle (the menu and policy modules import it) but never compiled here: `validateMenu` and
 * `resolvePolicy` are not exported, and a Worker refuses the code Ajv generates. Validate the menu and resolve the policy
 * where they are published (Bun or Node), and hand the results to the Worker. `tests/cloud-bundle.test.ts` holds the
 * bundle to that. Needs the `nodejs_compat` flag (`node:crypto`, `node:util`).
 */

export { menuCatalogRows } from "./billing/grants.js";
export {
	checkoutParams,
	lookupKeyOf,
	tierPriceKey,
	toStripeForm,
	withPriceIds,
} from "./billing/stripe-menu.js";
export { HANDLER_DDL } from "./handler/schema.js";
export {
	signStripePayload,
	verifyStripeSignature,
} from "./handler/stripe-signature.js";
export { handleStripeWebhook } from "./handler/stripe-webhook.js";
export { shipOutbox } from "./ledger/ship.js";
export {
	R2BindingStore,
	type R2BucketBinding,
} from "./store/r2-binding-store.js";
export type {
	BillingPolicy,
	CheckoutParamsWithPrices,
	Interval,
	Menu,
	ShipOutboxResult,
	SqlDatabase,
	SqlValue,
	WebhookContext,
	WebhookDeps,
	WebhookResponse,
} from "./types.js";
