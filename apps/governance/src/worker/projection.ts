/**
 * D1 projection of merge reviews: what listings read. Written by each
 * MergeReview Durable Object; idempotent, so a retry never duplicates.
 */
import {
  type GovernanceDecision,
  GovernanceDecisionSchema,
  type MergeReview,
  MergeReviewSchema,
  type MergeStatus,
  type ReviewerSummary,
} from "@eadwyn/shared-protocol";

export async function projectReviews(
  db: D1Database,
  reviews: MergeReview[],
  now: Date,
): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  for (const review of reviews) {
    statements.push(
      db
        .prepare(
          `INSERT INTO merge_reviews (candidate_id, round_id, status, created_at, updated_at, review_json)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(candidate_id) DO UPDATE SET
             status = excluded.status, updated_at = excluded.updated_at, review_json = excluded.review_json`,
        )
        .bind(
          review.candidate.candidateId,
          review.candidate.roundId,
          review.candidate.status,
          review.candidate.createdAt,
          now.toISOString(),
          JSON.stringify(review),
        ),
    );
    for (const d of review.decisions) {
      statements.push(
        db
          .prepare(
            `INSERT INTO decisions (decision_id, candidate_id, reviewer_id, verdict, rationale, created_at)
             VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(decision_id) DO NOTHING`,
          )
          .bind(d.decisionId, d.candidateId, d.reviewerId, d.verdict, d.rationale, d.createdAt),
      );
    }
  }
  if (statements.length > 0) {
    await db.batch(statements);
  }
}

export async function listProjectedReviews(
  db: D1Database,
  status: MergeStatus | "all",
): Promise<MergeReview[]> {
  const { results } = await db
    .prepare(
      "SELECT review_json FROM merge_reviews WHERE (?1 = 'all' OR status = ?1) ORDER BY created_at DESC, candidate_id",
    )
    .bind(status)
    .all<{ review_json: string }>();
  return results.map((row) => MergeReviewSchema.parse(JSON.parse(row.review_json)));
}

export async function listProjectedDecisions(
  db: D1Database,
  reviewerId?: string,
): Promise<GovernanceDecision[]> {
  const { results } = await db
    .prepare(
      `SELECT decision_id AS decisionId, candidate_id AS candidateId, reviewer_id AS reviewerId,
              verdict, rationale, created_at AS createdAt
         FROM decisions WHERE (?1 IS NULL OR reviewer_id = ?1) ORDER BY created_at DESC`,
    )
    .bind(reviewerId ?? null)
    .all();
  return results.map((row) => GovernanceDecisionSchema.parse(row));
}

export async function listProjectedReviewers(db: D1Database): Promise<ReviewerSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT reviewer_id AS reviewerId, COUNT(*) AS decisions,
              SUM(CASE WHEN verdict = 'approve' THEN 1 ELSE 0 END) AS approvals,
              SUM(CASE WHEN verdict = 'reject' THEN 1 ELSE 0 END) AS rejections,
              MAX(created_at) AS lastDecisionAt
         FROM decisions GROUP BY reviewer_id ORDER BY decisions DESC, reviewer_id`,
    )
    .all<ReviewerSummary>();
  return results;
}

export async function projectionCounts(
  db: D1Database,
): Promise<{ pendingMerges: number; decisions: number }> {
  const row = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM merge_reviews WHERE status = 'pending') AS pendingMerges,
              (SELECT COUNT(*) FROM decisions) AS decisions`,
    )
    .first<{ pendingMerges: number; decisions: number }>();
  return row ?? { pendingMerges: 0, decisions: 0 };
}
