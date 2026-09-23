/**
 * Review domain logic — pure functions over GovernanceState.
 *
 * Rules:
 *  - decisions are append-only and one per reviewer per candidate
 *  - only pending candidates accept decisions
 *  - a candidate is approved when distinct approvals reach the approval quorum,
 *    rejected when distinct rejections reach the rejection quorum
 *  - a merge candidate that leaves "pending" never comes back
 */
import { conflict, notFound } from "@eadwyn/service-kit";
import type {
  GovernanceDecision,
  MergeCandidate,
  MergeReview,
  MergeStatus,
  ReviewerSummary,
  Verdict,
} from "@eadwyn/shared-protocol";
import type { GovernanceState } from "../state";

export interface Quorums {
  approvalQuorum: number;
  rejectionQuorum: number;
}

export function findCandidate(state: GovernanceState, candidateId: string): MergeCandidate {
  const candidate = state.candidates.find((c) => c.candidateId === candidateId);
  if (!candidate) {
    throw notFound(`merge candidate ${candidateId}`);
  }
  return candidate;
}

export function acceptCandidate(state: GovernanceState, candidate: MergeCandidate): MergeCandidate {
  if (state.candidates.some((c) => c.candidateId === candidate.candidateId)) {
    throw conflict(
      "duplicate_candidate",
      `candidate ${candidate.candidateId} is already under review`,
    );
  }
  // Whatever the proposer says, a candidate enters review as pending.
  const accepted: MergeCandidate = { ...candidate, status: "pending" };
  state.candidates.push(accepted);
  return accepted;
}

export function buildReview(
  state: GovernanceState,
  candidate: MergeCandidate,
  quorums: Quorums,
): MergeReview {
  const decisions = state.decisions.filter((d) => d.candidateId === candidate.candidateId);
  const publication = state.publications[candidate.candidateId];
  return {
    candidate,
    decisions,
    tally: {
      approvals: decisions.filter((d) => d.verdict === "approve").length,
      rejections: decisions.filter((d) => d.verdict === "reject").length,
      approvalQuorum: quorums.approvalQuorum,
      rejectionQuorum: quorums.rejectionQuorum,
    },
    publishedVersion: publication?.version,
    publishError: publication?.error,
    publishRetrying: publication?.error ? publication.retryable !== false : undefined,
  };
}

export function listReviews(
  state: GovernanceState,
  status: MergeStatus | "all",
  quorums: Quorums,
): MergeReview[] {
  return state.candidates
    .filter((c) => status === "all" || c.status === status)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((c) => buildReview(state, c, quorums));
}

export interface DecisionInput {
  candidateId: string;
  reviewerId: string;
  verdict: Verdict;
  rationale: string;
  now: Date;
}

export function applyDecision(
  state: GovernanceState,
  input: DecisionInput,
  quorums: Quorums,
): { decision: GovernanceDecision; candidate: MergeCandidate; outcome: MergeStatus } {
  const candidate = findCandidate(state, input.candidateId);
  if (candidate.status !== "pending") {
    throw conflict(
      "merge_not_pending",
      `candidate ${candidate.candidateId} is ${candidate.status}`,
    );
  }
  if (
    state.decisions.some(
      (d) => d.candidateId === candidate.candidateId && d.reviewerId === input.reviewerId,
    )
  ) {
    throw conflict(
      "already_decided",
      `reviewer ${input.reviewerId} already decided on ${candidate.candidateId}`,
    );
  }
  const decision: GovernanceDecision = {
    decisionId: crypto.randomUUID(),
    candidateId: candidate.candidateId,
    reviewerId: input.reviewerId,
    verdict: input.verdict,
    rationale: input.rationale,
    createdAt: input.now.toISOString(),
  };
  state.decisions.push(decision);

  const tally = buildReview(state, candidate, quorums).tally;
  if (tally.rejections >= quorums.rejectionQuorum) {
    candidate.status = "rejected";
  } else if (tally.approvals >= quorums.approvalQuorum) {
    candidate.status = "approved";
  }
  return { decision, candidate, outcome: candidate.status };
}

export function recordPublication(
  state: GovernanceState,
  candidateId: string,
  result: { version: string } | { error: string; retryable: boolean },
  now: Date,
): void {
  const candidate = findCandidate(state, candidateId);
  const attempts = (state.publications[candidateId]?.attempts ?? 0) + 1;
  if ("version" in result) {
    candidate.status = "published";
    state.publications[candidateId] = { version: result.version, attempts, at: now.toISOString() };
  } else {
    state.publications[candidateId] = {
      error: result.error,
      retryable: result.retryable,
      attempts,
      at: now.toISOString(),
    };
  }
}

/** Approved candidates whose publish failed in a way a retry may fix. */
export function pendingPublications(state: GovernanceState, maxAttempts: number): MergeCandidate[] {
  return state.candidates.filter((candidate) => {
    if (candidate.status !== "approved") return false;
    const publication = state.publications[candidate.candidateId];
    if (!publication) return true;
    return (
      !publication.version &&
      publication.retryable !== false &&
      (publication.attempts ?? 0) < maxAttempts
    );
  });
}

export function summarizeReviewers(state: GovernanceState): ReviewerSummary[] {
  const byReviewer = new Map<string, ReviewerSummary>();
  for (const decision of state.decisions) {
    const summary = byReviewer.get(decision.reviewerId) ?? {
      reviewerId: decision.reviewerId,
      decisions: 0,
      approvals: 0,
      rejections: 0,
      lastDecisionAt: decision.createdAt,
    };
    summary.decisions += 1;
    if (decision.verdict === "approve") summary.approvals += 1;
    else summary.rejections += 1;
    if (decision.createdAt > summary.lastDecisionAt) summary.lastDecisionAt = decision.createdAt;
    byReviewer.set(decision.reviewerId, summary);
  }
  return [...byReviewer.values()].sort((a, b) => b.decisions - a.decisions);
}
