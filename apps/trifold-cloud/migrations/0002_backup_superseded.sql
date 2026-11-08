-- When each backup copy was first seen no longer matching its source (rewritten or deleted there). The prune pass
-- deletes a copy only 30 days after this, so retention counts from when a version stopped being current.
CREATE TABLE IF NOT EXISTS backup_superseded (
	copy_key TEXT PRIMARY KEY,
	first_seen TEXT NOT NULL
);
