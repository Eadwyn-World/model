/**
 * Inference edge HTTP surface: public-facing and read-mostly. It serves the
 * version in its served registry; it never trains or reviews.
 */
import type { ModelRegistry } from "@eadwyn/model-registry";
import { createServiceApp, type Logger, requireOperator, validateJson } from "@eadwyn/service-kit";
import {
  type EdgeSyncResponse,
  InferenceRequestSchema,
  type InferenceResponse,
  type ModelVersion,
} from "@eadwyn/shared-protocol";
import type { Hono } from "hono";
import type { InferenceBackend } from "./backends";
import { cacheKey, type ResponseCache } from "./cache";
import { syncServedModel } from "./sync";

export interface InferenceEdgeDeps {
  registry: ModelRegistry;
  backend: InferenceBackend;
  logger: Logger;
  cache?: ResponseCache;
  cacheTtlSeconds?: number;
  /** Fetches the coordinator's current version, for `POST /v1/sync`. */
  fetchPublished?: () => Promise<ModelVersion>;
  operatorToken?: string;
  version?: string;
}

export function createInferenceEdgeApp(deps: InferenceEdgeDeps): Hono {
  const { registry, backend, logger, cache } = deps;

  const app = createServiceApp({
    name: "inference-edge",
    version: deps.version ?? "0.1.0",
    description: "Serves the published model to the public.",
    logger,
    healthDetails: async () => {
      const model = await registry.getCurrent();
      return {
        servedModelVersion: model.version,
        architecture: model.architecture,
        backend: backend.name,
        runtimeModel: backend.model,
        adapter: backend.adapter,
        cache: cache ? "on" : "off",
        mockInference: backend.name === "mock",
      };
    },
  });

  app.get("/v1/model", async (c) => c.json(await registry.getCurrent()));

  app.get("/v1/model/versions", async (c) => {
    const [current, versions] = await Promise.all([registry.getCurrent(), registry.listVersions()]);
    return c.json({ current: current.version, versions });
  });

  app.post("/v1/infer", validateJson(InferenceRequestSchema), async (c) => {
    const started = performance.now();
    const { prompt, maxTokens } = c.req.valid("json");
    const served = await registry.getCurrent();
    const key = cache
      ? await cacheKey({
          modelVersion: served.version,
          backend: backend.name,
          model: backend.model,
          adapter: backend.adapter,
          prompt,
          maxTokens,
        })
      : undefined;
    if (cache && key) {
      const hit = await cache.get(key);
      if (hit) {
        const body: InferenceResponse = {
          ...hit,
          cached: true,
          latencyMs: Math.max(0, Math.round(performance.now() - started)),
        };
        return c.json(body);
      }
    }
    const answer = await backend.infer({ prompt, maxTokens, served });
    const body: InferenceResponse = {
      ...answer,
      cached: false,
      latencyMs: Math.max(1, Math.round(performance.now() - started)),
    };
    // Mock answers are cheap; only real model output is worth caching.
    if (cache && key && !body.mock) {
      await cache.put(key, body, deps.cacheTtlSeconds ?? 3600);
    }
    logger.debug("inference served", { modelVersion: served.version, backend: body.backend });
    return c.json(body);
  });

  app.post("/v1/sync", requireOperator(deps.operatorToken), async (c) => {
    if (!deps.fetchPublished) {
      return c.json(
        { error: { code: "sync_unavailable", message: "no coordinator is configured" } },
        503,
      );
    }
    const result: EdgeSyncResponse = await syncServedModel(registry, deps.fetchPublished);
    if (result.adopted) logger.info("adopted published model", { version: result.servedVersion });
    return c.json(result);
  });

  return app;
}
