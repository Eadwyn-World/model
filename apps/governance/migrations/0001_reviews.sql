-- Governance D1: a read projection of the per-merge Durable Objects.
-- Each MergeReview object is the source of truth for its candidate; it writes
-- these rows after every change (and retries from an alarm if D1 is down).
CREATE TABLE IF NOT EXISTS merge_reviews (
  candidate_id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  review_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS merge_reviews_by_status ON merge_reviews (status, created_at);

CREATE TABLE IF NOT EXISTS decisions (
  decision_id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  reviewer_id TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('approve', 'reject')),
  rationale TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS decisions_by_reviewer ON decisions (reviewer_id, created_at);
