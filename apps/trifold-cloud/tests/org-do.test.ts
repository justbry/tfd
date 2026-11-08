import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { migrateOrg, ORG_MIGRATIONS } from "../src/org-do";
import { durableState as stateOver } from "./fakes";

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
