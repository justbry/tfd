-- M0: the migration ledger's first row. Accounts, orgs and sessions arrive in M2 (PLAN.md section 4).
CREATE TABLE IF NOT EXISTS schema_meta (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
);
INSERT OR IGNORE INTO schema_meta (key, value) VALUES ('created_by', '0001_meta');
