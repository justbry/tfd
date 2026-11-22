-- Promissory notes: an agent's ref is per (note, agent), not organization-wide. `org_agents.agent_ref` stays as the
-- agent's organization-wide id (it keys links and sessions and never appears on a note); the ref an event carries is a
-- fresh random one per note, kept here. A borrower with two notes cannot tell that one staff member acted on both.
CREATE TABLE IF NOT EXISTS org_note_agents (
	org_id TEXT NOT NULL,
	note_id TEXT NOT NULL,
	agent_id TEXT NOT NULL,
	agent_ref TEXT NOT NULL,
	PRIMARY KEY (org_id, note_id, agent_id),
	UNIQUE (org_id, note_id, agent_ref)
);
-- Notes made before this migration stamped the organization-wide id on their events: each such agent keeps it as the
-- ref on every note of the organization. A note's own agent list still decides who is on it.
INSERT OR IGNORE INTO org_note_agents (org_id, note_id, agent_id, agent_ref)
	SELECT index_rows.org_id, index_rows.note_id, agents.agent_ref, agents.agent_ref
	FROM note_org_index AS index_rows
	JOIN org_agents AS agents ON agents.org_id = index_rows.org_id;
