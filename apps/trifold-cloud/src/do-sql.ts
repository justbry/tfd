import type { SqlDatabase, SqlValue } from "../../../packages/atm/src/cloud.ts";

/** The part of a Durable Object's `ctx.storage` the adapter uses. */
export type DurableSqlStorage = {
	sql: {
		exec(
			query: string,
			...bindings: unknown[]
		): { toArray(): Record<string, unknown>[] };
	};
	transactionSync<T>(work: () => T): T;
};

/**
 * Splits a script into statements on the semicolons outside string literals, dropping `--` comments (HANDLER_DDL's
 * comments hold semicolons). Enough for DDL: no triggers, no `BEGIN ... END` bodies.
 */
export const splitStatements = (script: string): string[] => {
	const statements: string[] = [];
	let current = "";
	let inString = false;
	for (let index = 0; index < script.length; index += 1) {
		const char = script[index] as string;
		if (inString) {
			current += char;
			if (char === "'") inString = false;
			continue;
		}
		if (char === "-" && script[index + 1] === "-") {
			const end = script.indexOf("\n", index);
			index = end === -1 ? script.length : end - 1;
			continue;
		}
		if (char === "'") inString = true;
		if (char === ";") {
			if (current.trim() !== "") statements.push(current.trim());
			current = "";
			continue;
		}
		current += char;
	}
	if (current.trim() !== "") statements.push(current.trim());
	return statements;
};

/**
 * tfd's `SqlDatabase` over Durable Object SQLite (PLAN.md section 3.1). DO SQLite refuses `BEGIN`/`COMMIT`, so
 * `transaction` is `transactionSync` (the handler never nests one). `run().changes` is read with `SELECT changes()`
 * right after the statement: the cursor's `rowsWritten` counts index writes too, and the handler needs exactly 1 for a
 * claim or a revision.
 */
export const durableSqlDatabase = (storage: DurableSqlStorage): SqlDatabase => {
	const { sql } = storage;
	return {
		exec: (script) => {
			for (const statement of splitStatements(script)) sql.exec(statement);
		},
		all: <T>(query: string, params: readonly SqlValue[] = []) =>
			sql.exec(query, ...params).toArray() as T[],
		run: (query, params = []) => {
			sql.exec(query, ...params).toArray();
			const [row] = sql.exec("SELECT changes() AS changes").toArray();
			return { changes: Number(row?.changes ?? 0) };
		},
		transaction: (work) => storage.transactionSync(work),
	};
};
