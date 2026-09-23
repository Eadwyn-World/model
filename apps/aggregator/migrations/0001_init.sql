-- Aggregator D1: accepted updates and proposed merge candidates.
-- The UNIQUE constraints are the race-free guarantee that an update is
-- accepted once and that a node contributes at most once per round.
CREATE TABLE IF NOT EXISTS updates (
  update_id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  body TEXT NOT NULL,
  received_at TEXT NOT NULL,
  UNIQUE (round_id, node_id)
);
CREATE INDEX IF NOT EXISTS updates_by_round ON updates (round_id, received_at);

CREATE TABLE IF NOT EXISTS candidates (
  candidate_id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  body TEXT NOT NULL,
  pipeline TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS candidates_by_created ON candidates (created_at);
