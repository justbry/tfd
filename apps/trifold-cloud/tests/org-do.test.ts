import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { migrateOrg, ORG_MIGRATIONS } from "../src/org-do";

/** A Durable Object state over bun:sqlite with the `sql.exec` and `transactionSync` shapes the runner uses. */
const stateOver = (db: Database) => ({
	storage: {
		sql: {
			exec: (query: string, ...bindings: unknown[]) => {
				const rows = db.query(query).all(...(bindings as never[])) as Record<
					string,
					unknown
				>[];
				return { toArray: () => rows };
			},
		},
		transactionSync: <T>(work: () => T): T => db.transaction(work)(),
	},
	blockConcurrencyWhile: async <T>(work: () => Promise<T>) => work(),
});

describe("org Durable Object migrations", () => {
	test("a new DO runs every step and records the version", () => {
		const db = new Database(":memory:");
		expect(migrateOrg(stateOver(db))).toBe(ORG_MIGRATIONS.length);
		expect(db.query("SELECT version FROM schema_version").get()).toEqual({
			version: ORG_MIGRATIONS.length,
		});
	});

	test("waking again runs nothing and keeps one version row", () => {
		const db = new Database(":memory:");
		migrateOrg(stateOver(db));
		expect(migrateOrg(stateOver(db))).toBe(ORG_MIGRATIONS.length);
		expect(db.query("SELECT COUNT(*) AS n FROM schema_version").get()).toEqual({
			n: 1,
		});
	});
});
