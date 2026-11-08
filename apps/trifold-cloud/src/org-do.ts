/**
 * One Durable Object per organization (PLAN.md section 3.1). M0 only creates its schema-version row; the tfd handler,
 * inbox and alarm arrive in M3.
 */
type SqlStorage = {
	exec(
		query: string,
		...bindings: unknown[]
	): { toArray(): Record<string, unknown>[] };
};
type DurableObjectState = { storage: { sql: SqlStorage } };

export const ORG_SCHEMA_VERSION = 1;

export class OrgDO {
	private readonly sql: SqlStorage;

	constructor(state: DurableObjectState, _env: unknown) {
		this.sql = state.storage.sql;
		this.sql.exec(
			"CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)",
		);
		const rows = this.sql.exec("SELECT version FROM schema_version").toArray();
		if (rows.length === 0) {
			this.sql.exec(
				"INSERT INTO schema_version (version) VALUES (?)",
				ORG_SCHEMA_VERSION,
			);
		}
	}

	async fetch(_request: Request): Promise<Response> {
		const [row] = this.sql.exec("SELECT version FROM schema_version").toArray();
		return Response.json({ schemaVersion: row?.version ?? null });
	}
}
