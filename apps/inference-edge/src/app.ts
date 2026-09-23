/**
 * Inference edge HTTP surface.
 *
 * Public-facing and read-mostly. It serves the model version it has pulled
 * into its local registry; it never participates in training or review.
 */
import type { ModelRegistry } from "@eadwyn/model-registry";
import { createServiceApp, type Logger, validateJson } from "@eadwyn/service-kit";
import { InferenceRequestSchema } from "@eadwyn/shared-protocol";
import type { Hono } from "hono";
import { mockInfer } from "./mock-inference";

export interface InferenceEdgeDeps {
  registry: ModelRegistry;
  logger: Logger;
  version?: string;
}

export function createInferenceEdgeApp(deps: InferenceEdgeDeps): Hono {
  const { registry, logger } = deps;

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
        mockInference: true,
      };
    },
  });

  app.get("/v1/model", async (c) => c.json(await registry.getCurrent()));

  app.get("/v1/model/versions", async (c) => {
    const [current, versions] = await Promise.all([registry.getCurrent(), registry.listVersions()]);
    return c.json({ current: current.version, versions });
  });

  app.post("/v1/infer", validateJson(InferenceRequestSchema), async (c) => {
    const startedAt = performance.now();
    const { prompt, maxTokens } = c.req.valid("json");
    const model = await registry.getCurrent();
    const response = mockInfer({ prompt, maxTokens, model, startedAt });
    logger.debug("inference served", { modelVersion: model.version, tokens: response.usage });
    return c.json(response);
  });

  return app;
}
