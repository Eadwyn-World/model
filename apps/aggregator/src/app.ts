/**
 * Aggregator HTTP surface.
 *
 * Accepts signed updates, keeps their references, and turns a round's updates
 * into a merge candidate that governance must review before anything is
 * published. Cross-service signals (progress to the coordinator, candidates
 * to governance) are best-effort so the aggregator keeps working when a
 * neighbour is down.
 */
import {
  bestEffort,
  createServiceApp,
  type Logger,
  notFound,
  validateJson,
  validateQuery,
  z,
} from "@eadwyn/service-kit";
import {
  CreateMergeRequestSchema,
  type MergeCandidate,
  type MergeCandidateListResponse,
  type MergeCandidateResponse,
  type StoredUpdate,
  type SubmitUpdateResponse,
  TrainingUpdateSchema,
  type UpdateListResponse,
  UuidSchema,
} from "@eadwyn/shared-protocol";
import type { Hono } from "hono";
import { buildMergeCandidate } from "./domain/merge";
import { type PublicKeyResolver, storeUpdate, validateUpdate } from "./domain/validate";
import type { AggregatorStore } from "./state";

export interface AggregatorConfig {
  maxDeltaBytes: number;
  verifySignatures: boolean;
}

export interface AggregatorDeps {
  store: AggregatorStore;
  logger: Logger;
  config: AggregatorConfig;
  /** Looks up a node's public key (normally: ask the coordinator). */
  resolvePublicKey?: PublicKeyResolver;
  /** Fired after an update is stored (normally: report progress to the coordinator). */
  onUpdateAccepted?: (update: StoredUpdate) => Promise<unknown>;
  /** Sends a candidate to governance for review. */
  forwardCandidate?: (candidate: MergeCandidate) => Promise<unknown>;
  now?: () => Date;
  version?: string;
}

export function createAggregatorApp(deps: AggregatorDeps): Hono {
  const { store, logger, config } = deps;
  const now = deps.now ?? (() => new Date());

  const app = createServiceApp({
    name: "aggregator",
    version: deps.version ?? "0.1.0",
    description: "Receives signed node updates and proposes merge candidates.",
    logger,
    healthDetails: async () => {
      const state = await store.read();
      return {
        updates: state.updates.length,
        candidates: state.candidates.length,
        verifySignatures: config.verifySignatures,
      };
    },
  });

  // --- updates ---------------------------------------------------------------
  app.post("/v1/updates", validateJson(TrainingUpdateSchema), async (c) => {
    const update = c.req.valid("json");
    const stored = await store.update(async (state) => {
      const verification = await validateUpdate(state, update, {
        maxDeltaBytes: config.maxDeltaBytes,
        verifySignatures: config.verifySignatures,
        resolvePublicKey: deps.resolvePublicKey,
      });
      return storeUpdate(state, update, verification, now());
    });
    logger.info("update accepted", {
      updateId: stored.updateId,
      nodeId: stored.nodeId,
      roundId: stored.roundId,
      verification: stored.verification,
    });
    if (deps.onUpdateAccepted) {
      await bestEffort(logger, "report round progress", () =>
        (deps.onUpdateAccepted as NonNullable<typeof deps.onUpdateAccepted>)(stored),
      );
    }
    const body: SubmitUpdateResponse = {
      accepted: true,
      updateId: stored.updateId,
      receivedAt: stored.receivedAt,
      verification: stored.verification,
    };
    return c.json(body, 201);
  });

  app.get("/v1/updates", validateQuery(z.object({ roundId: UuidSchema.optional() })), async (c) => {
    const { roundId } = c.req.valid("query");
    const state = await store.read();
    const updates = roundId ? state.updates.filter((u) => u.roundId === roundId) : state.updates;
    const body: UpdateListResponse = { updates, total: updates.length };
    return c.json(body);
  });

  app.get("/v1/updates/:updateId", async (c) => {
    const update = (await store.read()).updates.find((u) => u.updateId === c.req.param("updateId"));
    if (!update) {
      throw notFound(`update ${c.req.param("updateId")}`);
    }
    return c.json({ update });
  });

  // --- merges ----------------------------------------------------------------
  app.post("/v1/merges", validateJson(CreateMergeRequestSchema), async (c) => {
    const { roundId, method } = c.req.valid("json");
    const candidate = await store.update((state) => {
      const built = buildMergeCandidate({
        roundId,
        method,
        updates: state.updates.filter((u) => u.roundId === roundId),
        now: now(),
      });
      state.candidates.push(built);
      return built;
    });
    logger.info("merge candidate produced", {
      candidateId: candidate.candidateId,
      roundId,
      method,
      updates: candidate.updateIds.length,
    });
    let forwardedToGovernance = false;
    if (deps.forwardCandidate) {
      const result = await bestEffort(logger, "forward candidate to governance", () =>
        (deps.forwardCandidate as NonNullable<typeof deps.forwardCandidate>)(candidate),
      );
      forwardedToGovernance = result.ok;
    }
    const body: MergeCandidateResponse = { candidate, forwardedToGovernance };
    return c.json(body, 201);
  });

  app.get("/v1/merges", async (c) => {
    const state = await store.read();
    const candidates = state.candidates
      .slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const body: MergeCandidateListResponse = { candidates, total: candidates.length };
    return c.json(body);
  });

  app.get("/v1/merges/:candidateId", async (c) => {
    const candidate = (await store.read()).candidates.find(
      (m) => m.candidateId === c.req.param("candidateId"),
    );
    if (!candidate) {
      throw notFound(`merge candidate ${c.req.param("candidateId")}`);
    }
    return c.json({ candidate });
  });

  return app;
}
