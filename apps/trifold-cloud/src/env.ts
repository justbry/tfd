/** The few binding shapes this Worker uses, typed locally so the package needs no workers-types dependency. */
export type D1PreparedStatement = {
	bind(...values: unknown[]): D1PreparedStatement;
	first<T = Record<string, unknown>>(): Promise<T | null>;
	all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
	run(): Promise<unknown>;
};

export type D1Database = { prepare(query: string): D1PreparedStatement };

export type R2Object = {
	key: string;
	etag: string;
	size: number;
	uploaded: Date;
	customMetadata?: Record<string, string>;
};

export type R2ObjectBody = R2Object & { body: ReadableStream };

export type R2Bucket = {
	list(options?: { limit?: number; cursor?: string }): Promise<{
		objects: R2Object[];
		truncated: boolean;
		cursor?: string;
	}>;
	head(key: string): Promise<R2Object | null>;
	delete(key: string): Promise<void>;
	/** With `onlyIf`, R2 answers the object without a body when the precondition fails. */
	get(
		key: string,
		options?: { onlyIf?: { etagMatches?: string } },
	): Promise<R2ObjectBody | R2Object | null>;
	put(
		key: string,
		body: ReadableStream,
		options?: { customMetadata?: Record<string, string> },
	): Promise<unknown>;
};

export type DurableObjectStub = { fetch(request: Request): Promise<Response> };

export type DurableObjectNamespace = {
	idFromName(name: string): unknown;
	get(id: unknown): DurableObjectStub;
};

/** A Secrets Store binding. */
export type SecretBinding = { get(): Promise<string> };

export type CloudEnv = {
	DB: D1Database;
	/** The books: `schools/<orgId>/…` (PLAN.md section 6). */
	BOOKS: R2Bucket;
	/** Versioned copies of BOOKS, under a bucket lock (PLAN.md M0). */
	BACKUPS: R2Bucket;
	ORG: DurableObjectNamespace;
	/** One Durable Object per promissory note: its log, chain, sessions and codes (`src/notes/note-do.ts`). */
	NOTE: DurableObjectNamespace;
	/** Ed25519 private keys (PKCS8 PEM), one per purpose (PLAN.md section 3.5). */
	SIGNING_RECEIPT: SecretBinding;
	SIGNING_SEAL: SecretBinding;
	SIGNING_DIRECTORY: SecretBinding;
	/** Subrequests one backup run may use; 900 fits the Free plan's limit, raise toward 9,000 on Paid. */
	BACKUP_SUBREQUEST_BUDGET?: string;
	ENVIRONMENT: "staging" | "production";
	/** The product UI host, e.g. staging-ledger.trifold.app. */
	LEDGER_HOST: string;
	/** The API host, e.g. staging-api.trifold.app. */
	API_HOST: string;
	/** Trifold's own billing (PLAN.md section 5), a Worker secret: a TEST-mode key on staging (`sk_test_` or `rk_test_`). */
	STRIPE_SECRET_KEY?: string;
	/** The signing secret of the `/webhooks/billing` endpoint, a Worker secret. */
	STRIPE_BILLING_WEBHOOK_SECRET?: string;
	/** Keys the note ids' MAC, the form tokens and the step-up code hashes (`src/notes/`), a Worker secret of at least 32 characters. Shorter or unset: every notes route answers 503. */
	NOTES_SESSION_SECRET?: string;
	/** The key id published for the `receipt` signing key, used on note receipts, payoff statements and releases. Unset: the note document routes answer 503. */
	NOTES_RECEIPT_KEY_ID?: string;
	/** The key id published for the `seal` signing key, used on note chain seals. Unset: the note document routes answer 503. */
	NOTES_SEAL_KEY_ID?: string;
	/** The published public keys as JSON (key id to PEM, or to `{ pem, purpose, not_before, not_after }`), for the verify link's document check. Unset: the page says the check is not configured. */
	NOTES_PUBLIC_KEYS_JSON?: string;
	/** The bearer key of `POST /v1/notes` and `GET /v1/notes/:id/statement`, a Worker secret. Unset: those routes answer 401. */
	NOTES_API_KEY?: string;
};
