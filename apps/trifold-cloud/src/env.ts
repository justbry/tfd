/** The few binding shapes this Worker uses, typed locally so the package needs no workers-types dependency. */
export type D1PreparedStatement = {
	bind(...values: unknown[]): D1PreparedStatement;
	first<T = Record<string, unknown>>(): Promise<T | null>;
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
};
