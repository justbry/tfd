import type { R2BucketBinding } from "tfd/worker";

/** The Worker's static assets (the ledger UI build), bound as `ASSETS` when the wrangler config has an `assets` block. */
export type AssetsBinding = { fetch(request: Request): Promise<Response> };

/** What the Worker needs from its environment (wrangler `vars` and bindings; no secrets). */
export type LedgerEnv = {
	/** The school's event log and views: `schools/<id>/...` in this environment's bucket. */
	LEDGER_BUCKET: R2BucketBinding;
	/** The token issuer: the family service's `API_BASE` of this environment. A token with another `iss` is refused. */
	LEDGER_ISS: string;
	/** The family service's `/.well-known/ledger-jwks.json`. */
	LEDGER_JWKS_URL: string;
	ASSETS?: AssetsBinding;
	/** Test harness only: a URL that answers the clock as an ISO instant (see `testing/worker-entry.ts`). */
	TEST_CLOCK_URL?: string;
};

/** What a cron trigger hands `scheduled`. */
export type ScheduledController = { scheduledTime: number; cron: string };
