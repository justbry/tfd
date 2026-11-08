/**
 * One Durable Object per organization (PLAN.md section 3.1). M0 only lays down the migration runner; the tfd handler,
 * inbox and alarm arrive in M3 as further steps.
 */
type SqlStorage = {
	exec(
		query: string,
		...bindings: unknown[]
	): { toArray(): Record<string, unknown>[] };
};
type DurableObjectState = {
	storage: { sql: SqlStorage; transactionSync<T>(work: () => T): T };
	blockConcurrencyWhile<T>(work: () => Promise<T>): Promise<T>;
};

/**
 * Numbered schema steps, applied in order, each in its own transaction, the first time a DO wakes after a deploy.
 * Never edit a released step; add the next one.
 */
export const ORG_MIGRATIONS: readonly string[] = [
	// 1: nothing yet besides the version table itself (created by the runner).
	"SELECT 1",
];

export const migrateOrg = (state: DurableObjectState): number => {
	const { sql } = state.storage;
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
			sql.exec(step);
			sql.exec("UPDATE schema_version SET version = ?", version + 1);
		});
	}
	return version;
};

export class OrgDO {
	private version = 0;

	constructor(state: DurableObjectState, _env: unknown) {
		void state.blockConcurrencyWhile(async () => {
			this.version = migrateOrg(state);
		});
	}

	async fetch(_request: Request): Promise<Response> {
		return Response.json({ schemaVersion: this.version });
	}
}
