-- Promissory notes, build step 4: organizations as parties. The cross-note index of an organization's notes, its agents,
-- and their links, sessions and rate counters. No plain email address is stored here: an agent is found by email_hash,
-- a sha256 of the address under NOTES_SESSION_SECRET and the org id, used only to match a link request. The addresses
-- live in each note's own Durable Object. Tokens and cookie values are stored as sha256 hashes.
CREATE TABLE IF NOT EXISTS note_org_index (
	org_id TEXT NOT NULL,
	note_id TEXT NOT NULL,
	party_role TEXT NOT NULL,
	created_at TEXT NOT NULL,
	PRIMARY KEY (org_id, note_id)
);
CREATE TABLE IF NOT EXISTS org_agents (
	org_id TEXT NOT NULL,
	agent_ref TEXT NOT NULL,
	email_hash TEXT NOT NULL,
	role TEXT NOT NULL,
	active INTEGER NOT NULL DEFAULT 1,
	added_at TEXT NOT NULL,
	PRIMARY KEY (org_id, agent_ref),
	UNIQUE (org_id, email_hash)
);
CREATE TABLE IF NOT EXISTS org_links (
	org_id TEXT NOT NULL,
	hash TEXT NOT NULL,
	agent_ref TEXT NOT NULL,
	expires_at TEXT NOT NULL,
	used_at TEXT,
	PRIMARY KEY (org_id, hash)
);
CREATE TABLE IF NOT EXISTS org_sessions (
	org_id TEXT NOT NULL,
	hash TEXT NOT NULL,
	agent_ref TEXT NOT NULL,
	created_at TEXT NOT NULL,
	last_seen_at TEXT NOT NULL,
	absolute_expires_at TEXT NOT NULL,
	PRIMARY KEY (org_id, hash)
);
CREATE TABLE IF NOT EXISTS org_counters (
	org_id TEXT NOT NULL,
	counter_key TEXT NOT NULL,
	window_start INTEGER NOT NULL,
	hits INTEGER NOT NULL,
	PRIMARY KEY (org_id, counter_key)
);
