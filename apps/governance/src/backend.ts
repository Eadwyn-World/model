/**
 * GovernanceBackend — what the governance routes need, independent of where
 * reviews are stored. Two implementations:
 *
 *  - createDocumentGovernanceBackend: every review in one document (a JSON
 *    file on Node). Each Cloudflare `MergeReview` Durable Object also runs it,
 *    over a document holding just its own candidate.
 *  - the Cloudflare backend (src/worker): one Durable Object per candidate,
 *    with a D1 projection for listings.
 */
import { bestEffort, type JsonStore, type Logger, notFound } from "@eadwyn/service-kit";
import type {
  GovernanceDecision,
  MergeCandidate,
  MergeReview,
  MergeStatus,
  ReviewerSummary,
  Verdict,
} from "@eadwyn/shared-protocol";
import {
  acceptCandidate,
  applyDecision,
  buildReview,
  findCandidate,
  listReviews,
  pendingPublications,
  type Quorums,
  recordPublication,
  summarizeReviewers,
} from "./domain/review";
import type { GovernanceState } from "./state";

export interface DecisionInput {
  reviewerId: string;
  verdict: Verdict;
  rationale: string;
}

export interface DecisionOutcome {
  decision: GovernanceDecision;
  review: MergeReview;
}

export interface GovernanceBackend {
  listReviews(status: MergeStatus | "all"): Promise<MergeReview[]>;
  getReview(candidateId: string): Promise<MergeReview>;
  submitCandidate(candidate: MergeCandidate): Promise<MergeCandidate>;
  decide(candidateId: string, input: DecisionInput): Promise<DecisionOutcome>;
  listDecisions(reviewerId?: string): Promise<GovernanceDecision[]>;
  listReviewers(): Promise<ReviewerSummary[]>;
  /** Retries approved-but-unpublished merges; returns how many are still pending. */
  retryPendingPublications(): Promise<number>;
  health(): Promise<Record<string, unknown>>;
}

/** Asks the coordinator to publish an approved candidate; resolves with the new version. */
export type Publisher = (candidate: MergeCandidate) => Promise<{ version: string }>;

export const MAX_PUBLISH_ATTEMPTS = 10;

/** A publish that failed on a stale base or a duplicate version will fail the same way again. */
export function isRetryablePublishError(error: unknown): boolean {
  const status = (error as { status?: unknown })?.status;
  if (
    typeof status === "number" &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 429
  ) {
    return false;
  }
  return true;
}

export interface DocumentBackendOptions {
  store: JsonStore<GovernanceState>;
  quorums: Quorums;
  publish?: Publisher;
  logger: Logger;
  now?: () => Date;
}

export function createDocumentGovernanceBackend(
  options: DocumentBackendOptions,
): GovernanceBackend {
  const { store, quorums, publish, logger } = options;
  const now = options.now ?? (() => new Date());

  async function publishApproved(candidate: MergeCandidate): Promise<void> {
    if (!publish) return;
    const result = await bestEffort(logger, "publish approved merge", () => publish(candidate));
    await store.update((state) =>
      recordPublication(
        state,
        candidate.candidateId,
        result.ok
          ? { version: result.value.version }
          : {
              error: result.error instanceof Error ? result.error.message : String(result.error),
              retryable: isRetryablePublishError(result.error),
            },
        now(),
      ),
    );
    if (result.ok) {
      logger.info("merge published", {
        candidateId: candidate.candidateId,
        version: result.value.version,
      });
    }
  }

  return {
    async listReviews(status) {
      return listReviews(await store.read(), status, quorums);
    },
    async getReview(candidateId) {
      const state = await store.read();
      return buildReview(state, findCandidate(state, candidateId), quorums);
    },
    async submitCandidate(candidate) {
      const accepted = await store.update((state) => acceptCandidate(state, candidate));
      logger.info("candidate entered review", {
        candidateId: accepted.candidateId,
        roundId: accepted.roundId,
        method: accepted.aggregation.method,
      });
      return accepted;
    },
    async decide(candidateId, input) {
      const { decision, candidate, outcome } = await store.update((state) =>
        applyDecision(state, { ...input, candidateId, now: now() }, quorums),
      );
      logger.info("decision recorded", {
        candidateId,
        reviewerId: decision.reviewerId,
        verdict: decision.verdict,
        outcome,
      });
      if (outcome === "approved") {
        await publishApproved(candidate);
      }
      const state = await store.read();
      return { decision, review: buildReview(state, findCandidate(state, candidateId), quorums) };
    },
    async listDecisions(reviewerId) {
      return (await store.read()).decisions
        .filter((d) => !reviewerId || d.reviewerId === reviewerId)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },
    async listReviewers() {
      return summarizeReviewers(await store.read());
    },
    async retryPendingPublications() {
      for (const candidate of pendingPublications(await store.read(), MAX_PUBLISH_ATTEMPTS)) {
        await publishApproved(candidate);
      }
      return pendingPublications(await store.read(), MAX_PUBLISH_ATTEMPTS).length;
    },
    async health() {
      const state = await store.read();
      return {
        pendingMerges: state.candidates.filter((c) => c.status === "pending").length,
        decisions: state.decisions.length,
        approvalQuorum: quorums.approvalQuorum,
      };
    },
  };
}

export function requireCandidate(
  review: MergeReview | undefined,
  candidateId: string,
): MergeReview {
  if (!review) throw notFound(`merge candidate ${candidateId}`);
  return review;
}
