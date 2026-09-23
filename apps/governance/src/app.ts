/**
 * Governance HTTP surface — the "review merges" layer.
 *
 * Nothing here trains or aggregates. It records what reviewers decided and,
 * when a candidate reaches quorum, asks the coordinator to publish it. The
 * decision log is the audit trail of how the mind changed.
 */
import {
  createServiceApp,
  type Logger,
  requireInternal,
  validateJson,
  validateQuery,
  z,
} from "@eadwyn/service-kit";
import {
  type DecisionListResponse,
  DecisionRequestSchema,
  type DecisionResponse,
  MergeCandidateSchema,
  type MergeReviewListResponse,
  MergeStatusSchema,
  type ReviewerListResponse,
} from "@eadwyn/shared-protocol";
import type { Hono } from "hono";
import type { GovernanceBackend } from "./backend";
import type { ReviewerResolver } from "./reviewers";

export interface GovernanceDeps {
  backend: GovernanceBackend;
  resolveReviewer: ReviewerResolver;
  logger: Logger;
  version?: string;
}

export function createGovernanceApp(deps: GovernanceDeps): Hono {
  const { backend, resolveReviewer, logger } = deps;

  const app = createServiceApp({
    name: "governance",
    version: deps.version ?? "0.1.0",
    description: "Review queue and decision log for merges into the global model.",
    logger,
    healthDetails: () => backend.health(),
  });

  // --- merges ----------------------------------------------------------------
  app.get(
    "/v1/merges",
    validateQuery(z.object({ status: MergeStatusSchema.or(z.literal("all")).default("pending") })),
    async (c) => {
      const merges = await backend.listReviews(c.req.valid("query").status);
      const body: MergeReviewListResponse = { merges, total: merges.length };
      return c.json(body);
    },
  );

  // Candidates come from the aggregator's merge pipeline, never from the public.
  app.post("/v1/merges", requireInternal(), validateJson(MergeCandidateSchema), async (c) => {
    const candidate = await backend.submitCandidate(c.req.valid("json"));
    return c.json({ candidate }, 201);
  });

  app.get("/v1/merges/:candidateId", async (c) =>
    c.json(await backend.getReview(c.req.param("candidateId"))),
  );

  app.post("/v1/merges/:candidateId/decisions", validateJson(DecisionRequestSchema), async (c) => {
    const input = c.req.valid("json");
    const reviewerId = await resolveReviewer(c, input.reviewerId);
    const outcome = await backend.decide(c.req.param("candidateId"), {
      reviewerId,
      verdict: input.verdict,
      rationale: input.rationale,
    });
    const body: DecisionResponse = outcome;
    return c.json(body, 201);
  });

  // --- decisions and reviewers -----------------------------------------------
  app.get(
    "/v1/decisions",
    validateQuery(z.object({ reviewerId: z.string().min(1).optional() })),
    async (c) => {
      const decisions = await backend.listDecisions(c.req.valid("query").reviewerId);
      const body: DecisionListResponse = { decisions, total: decisions.length };
      return c.json(body);
    },
  );

  app.get("/v1/reviewers", async (c) => {
    const reviewers = await backend.listReviewers();
    const body: ReviewerListResponse = { reviewers, total: reviewers.length };
    return c.json(body);
  });

  return app;
}
