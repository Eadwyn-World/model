/**
 * Aggregator HTTP surface.
 *
 * Nodes ask where to put their delta, upload it, then submit the signed
 * update that references it. Operators (or other services) start a merge;
 * the pipeline aggregates and forwards the candidate to governance. Nothing
 * here publishes: that is governance's decision.
 */
import {
  bestEffort,
  createServiceApp,
  type Logger,
  notFound,
  requireOperator,
  validateJson,
  validateQuery,
  z,
} from "@eadwyn/service-kit";
import {
  CreateMergeRequestSchema,
  type DeltaUploadReceipt,
  DeltaUploadRequestSchema,
  type MergeCandidateDetail,
  type MergeCandidateListResponse,
  type MergeCandidateResponse,
  type StoredUpdate,
  type SubmitUpdateResponse,
  TrainingUpdateSchema,
  type UpdateListResponse,
  UuidSchema,
} from "@eadwyn/shared-protocol";
import type { Hono } from "hono";
import { acceptUpdate } from "./domain/accept";
import { proposeMerge } from "./domain/merge";
import { queuedPipeline } from "./domain/pipeline";
import { issueUploadTarget, type UploadSettings, verifyUploadToken } from "./domain/uploads";
import type { AggregatorContext, MergePipelineRunner } from "./ports";

export interface AggregatorDeps extends AggregatorContext {
  logger: Logger;
  uploads: UploadSettings;
  pipeline: MergePipelineRunner;
  /** After an update is stored: tell the coordinator (directly on Node, via a queue on Cloudflare). */
  reportProgress?: (update: StoredUpdate) => Promise<unknown>;
  operatorToken?: string;
  version?: string;
}

export function createAggregatorApp(deps: AggregatorDeps): Hono {
  const { repository, objectStore, logger } = deps;

  const app = createServiceApp({
    name: "aggregator",
    version: deps.version ?? "0.1.0",
    description: "Receives signed node updates and proposes merge candidates.",
    logger,
    healthDetails: async () => ({
      ...(await repository.counts()),
      verifySignatures: deps.verifySignatures,
      objectStore: objectStore?.kind ?? "none",
      uploads: objectStore?.presignPut ? "presigned" : objectStore ? "direct" : "unavailable",
    }),
  });

  // --- deltas ------------------------------------------------------------------
  app.post("/v1/updates/upload-target", validateJson(DeltaUploadRequestSchema), async (c) => {
    const target = await issueUploadTarget({
      request: c.req.valid("json"),
      origin: new URL(c.req.url).origin,
      objectStore,
      resolvePublicKey: deps.verifySignatures ? deps.resolvePublicKey : undefined,
      settings: deps.uploads,
      now: deps.now(),
    });
    return c.json(target, 201);
  });

  app.put("/v1/deltas/:roundId/:updateId", async (c) => {
    const roundId = UuidSchema.parse(c.req.param("roundId"));
    const updateId = UuidSchema.parse(c.req.param("updateId"));
    const { key, sha256, bytes } = await verifyUploadToken({
      roundId,
      updateId,
      query: c.req.query(),
      settings: deps.uploads,
      now: deps.now(),
    });
    if (!objectStore) {
      return c.json(
        { error: { code: "upload_unavailable", message: "no object store is configured" } },
        503,
      );
    }
    const declared = Number(c.req.header("content-length") ?? Number.NaN);
    if (!Number.isNaN(declared) && declared !== bytes) {
      return c.json(
        { error: { code: "delta_mismatch", message: `expected ${bytes} bytes, got ${declared}` } },
        400,
      );
    }
    const body = c.req.raw.body ?? new Uint8Array();
    try {
      const stored = await objectStore.put("deltas", key, body, { sha256, bytes });
      const receipt: DeltaUploadReceipt = {
        uri: `store://deltas/${key}`,
        sha256: stored.sha256 ?? sha256,
        bytes: stored.bytes,
        storedAt: deps.now().toISOString(),
      };
      return c.json(receipt, 201);
    } catch (error) {
      if (error instanceof Error && error.name === "ObjectIntegrityError") {
        return c.json({ error: { code: "delta_mismatch", message: error.message } }, 400);
      }
      throw error;
    }
  });

  // --- updates -----------------------------------------------------------------
  app.post("/v1/updates", validateJson(TrainingUpdateSchema), async (c) => {
    const stored = await acceptUpdate(deps, c.req.valid("json"));
    logger.info("update accepted", {
      updateId: stored.updateId,
      nodeId: stored.nodeId,
      roundId: stored.roundId,
      verification: stored.verification,
    });
    if (deps.reportProgress) {
      await bestEffort(logger, "report round progress", () =>
        (deps.reportProgress as NonNullable<typeof deps.reportProgress>)(stored),
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
    const updates = await repository.listUpdates(c.req.valid("query").roundId);
    const body: UpdateListResponse = { updates, total: updates.length };
    return c.json(body);
  });

  app.get("/v1/updates/:updateId", async (c) => {
    const update = await repository.getUpdate(c.req.param("updateId"));
    if (!update) throw notFound(`update ${c.req.param("updateId")}`);
    return c.json({ update });
  });

  // --- merges ------------------------------------------------------------------
  app.post(
    "/v1/merges",
    requireOperator(deps.operatorToken),
    validateJson(CreateMergeRequestSchema),
    async (c) => {
      const { roundId, method } = c.req.valid("json");
      const proposed = await proposeMerge({
        roundId,
        method,
        updates: await repository.listUpdates(roundId),
        objectStore,
        now: deps.now(),
      });
      const pipeline = queuedPipeline(proposed.candidate.candidateId, deps.now());
      await repository.insertCandidate(proposed.candidate, pipeline);
      await deps.pipeline.start(proposed.candidate.candidateId);
      logger.info("merge candidate proposed", {
        candidateId: proposed.candidate.candidateId,
        roundId,
        method,
        updates: proposed.candidate.updateIds.length,
        skipped: proposed.skipped,
      });
      const body: MergeCandidateResponse = {
        candidate: proposed.candidate,
        forwardedToGovernance: false,
        pipeline,
      };
      return c.json(body, 201);
    },
  );

  app.get("/v1/merges", async (c) => {
    const candidates = await repository.listCandidates();
    const body: MergeCandidateListResponse = { candidates, total: candidates.length };
    return c.json(body);
  });

  app.get("/v1/merges/:candidateId", async (c) => {
    const found = await repository.getCandidate(c.req.param("candidateId"));
    if (!found) throw notFound(`merge candidate ${c.req.param("candidateId")}`);
    const body: MergeCandidateDetail = found;
    return c.json(body);
  });

  return app;
}
