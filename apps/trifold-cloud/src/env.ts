/** The few binding shapes this Worker uses, typed locally so the package needs no workers-types dependency. */
export type D1Database = {
	prepare(query: string): { first<T = unknown>(): Promise<T | null> };
};

export type R2Object = {
	key: string;
	etag: string;
	size: number;
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
	get(key: string): Promise<R2ObjectBody | null>;
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

export type CloudEnv = {
	DB: D1Database;
	BOOKS: R2Bucket;
	/** Nightly copy of BOOKS, under a bucket lock (PLAN.md M0). */
	BACKUPS: R2Bucket;
	ORG: DurableObjectNamespace;
	ENVIRONMENT: "staging" | "production";
	/** The product UI host, e.g. staging-ledger.trifold.app. */
	LEDGER_HOST: string;
	/** The API host, e.g. staging-api.trifold.app. */
	API_HOST: string;
};
