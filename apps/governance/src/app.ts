/**
 * Governance HTTP surface — the "review merges" layer.
 *
 * Nothing here trains or aggregates. It records what reviewers decided and,
 * when a candidate reaches quorum, asks the coordinator to publish it. The
 * decision log is the audit trail of how the mind changed.
 */
import {
  bestEffort,
  createServiceApp,
  type Logger,
  validateJson,
  validateQuery,
  z,
} from "@eadwyn/service-kit";
import {
  type DecisionListResponse,
  DecisionRequestSchema,
  type DecisionResponse,
  type MergeCandidate,
  MergeCandidateSchema,
  type MergeReviewListResponse,
  MergeStatusSchema,
  type ReviewerListResponse,
} from "@eadwyn/shared-protocol";
import type { Hono } from "hono";
import {
  acceptCandidate,
  applyDecision,
  buildReview,
  findCandidate,
  listReviews,
  type Quorums,
  recordPublication,
  summarizeReviewers,
} from "./domain/review";
import type { GovernanceStore } from "./state";

export interface GovernanceDeps {
  store: GovernanceStore;
  logger: Logger;
  config: Quorums;
  /** Publishes an approved candidate (normally: the coordinator). Resolves with the new version. */
  publish?: (candidate: MergeCandidate) => Promise<{ version: string }>;
  now?: () => Date;
  version?: string;
}

export function createGovernanceApp(deps: GovernanceDeps): Hono {
  const { store, logger, config } = deps;
  const now = deps.now ?? (() => new Date());

  const app = createServiceApp({
    name: "governance",
    version: deps.version ?? "0.1.0",
    description: "Review queue and decision log for merges into the global model.",
    logger,
    healthDetails: async () => {
      const state = await store.read();
      return {
        pendingMerges: state.candidates.filter((c) => c.status === "pending").length,
        decisions: state.decisions.length,
        approvalQuorum: config.approvalQuorum,
      };
    },
  });

  // --- merges ----------------------------------------------------------------
  app.get(
    "/v1/merges",
    validateQuery(z.object({ status: MergeStatusSchema.or(z.literal("all")).default("pending") })),
    async (c) => {
      const { status } = c.req.valid("query");
      const merges = listReviews(await store.read(), status, config);
      const body: MergeReviewListResponse = { merges, total: merges.length };
      return c.json(body);
    },
  );

  app.post("/v1/merges", validateJson(MergeCandidateSchema), async (c) => {
    const candidate = await store.update((state) => acceptCandidate(state, c.req.valid("json")));
    logger.info("candidate entered review", {
      candidateId: candidate.candidateId,
      roundId: candidate.roundId,
      method: candidate.aggregation.method,
    });
    return c.json({ candidate }, 201);
  });

  app.get("/v1/merges/:candidateId", async (c) => {
    const state = await store.read();
    const candidate = findCandidate(state, c.req.param("candidateId"));
    return c.json(buildReview(state, candidate, config));
  });

  app.post("/v1/merges/:candidateId/decisions", validateJson(DecisionRequestSchema), async (c) => {
    const input = c.req.valid("json");
    const candidateId = c.req.param("candidateId");
    const { decision, candidate, outcome } = await store.update((state) =>
      applyDecision(state, { ...input, candidateId, now: now() }, config),
    );
    logger.info("decision recorded", {
      candidateId,
      reviewerId: decision.reviewerId,
      verdict: decision.verdict,
      outcome,
    });

    if (outcome === "approved" && deps.publish) {
      const result = await bestEffort(logger, "publish approved merge", () =>
        (deps.publish as NonNullable<typeof deps.publish>)(candidate),
      );
      await store.update((state) =>
        recordPublication(
          state,
          candidateId,
          result.ok
            ? { version: result.value.version }
            : {
                error: result.error instanceof Error ? result.error.message : String(result.error),
              },
          now(),
        ),
      );
      if (result.ok) {
        logger.info("merge published", { candidateId, version: result.value.version });
      }
    }

    const state = await store.read();
    const body: DecisionResponse = {
      decision,
      review: buildReview(state, findCandidate(state, candidateId), config),
    };
    return c.json(body, 201);
  });

  // --- decisions and reviewers -----------------------------------------------
  app.get(
    "/v1/decisions",
    validateQuery(z.object({ reviewerId: z.string().min(1).optional() })),
    async (c) => {
      const { reviewerId } = c.req.valid("query");
      const state = await store.read();
      const decisions = state.decisions
        .filter((d) => !reviewerId || d.reviewerId === reviewerId)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      const body: DecisionListResponse = { decisions, total: decisions.length };
      return c.json(body);
    },
  );

  app.get("/v1/reviewers", async (c) => {
    const reviewers = summarizeReviewers(await store.read());
    const body: ReviewerListResponse = { reviewers, total: reviewers.length };
    return c.json(body);
  });

  return app;
}
