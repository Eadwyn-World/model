import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModelRegistry } from "@eadwyn/model-registry";
import { createLogger } from "@eadwyn/service-kit";
import {
  HealthResponseSchema,
  InferenceResponseSchema,
  ModelVersionSchema,
} from "@eadwyn/shared-protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createInferenceEdgeApp } from "../app";

let dir: string;
let app: ReturnType<typeof createInferenceEdgeApp>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "eadwyn-edge-"));
  app = createInferenceEdgeApp({
    registry: createModelRegistry({ filePath: join(dir, "registry.json") }),
    logger: createLogger({ service: "edge-test", level: "error" }),
  });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("inference edge", () => {
  it("reports health with the served model", async () => {
    const health = HealthResponseSchema.parse(await (await app.request("/health")).json());
    expect(health.status).toBe("ok");
    expect(health.service).toBe("inference-edge");
    expect(health.details).toMatchObject({ servedModelVersion: "0.3.1", mockInference: true });
  });

  it("returns the published model metadata", async () => {
    const model = ModelVersionSchema.parse(await (await app.request("/v1/model")).json());
    expect(model.version).toBe("0.3.1");
    expect(model.license).toBe("Apache-2.0");
  });

  it("answers with a clearly-marked mock inference and validates input", async () => {
    const res = await app.request("/v1/infer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "How does the mind rebalance?", maxTokens: 24 }),
    });
    expect(res.status).toBe(200);
    const body = InferenceResponseSchema.parse(await res.json());
    expect(body.mock).toBe(true);
    expect(body.modelVersion).toBe("0.3.1");
    expect(body.usage.completionTokens).toBeLessThanOrEqual(24);
    expect(body.output).toContain("mock");

    const bad = await app.request("/v1/infer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "" }),
    });
    expect(bad.status).toBe(400);
  });
});
