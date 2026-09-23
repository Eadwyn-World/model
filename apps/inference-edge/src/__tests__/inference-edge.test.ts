import { createModelRegistry, genesisRegistry, registryCodec } from "@eadwyn/model-registry";
import { CALLER_HEADER, createLogger, createMemoryStore } from "@eadwyn/service-kit";
import type { ModelVersion } from "@eadwyn/shared-protocol";
import { describe, expect, it } from "vitest";
import { createInferenceEdgeApp } from "../app";
import { createMockBackend, createUpstreamBackend, createWorkersAiBackend } from "../backends";
import { createMemoryCache } from "../cache";
import { edgeContract } from "./contract";

const logger = createLogger({ service: "edge-test", level: "error" });

export function publishedModel(version = "0.2.0"): ModelVersion {
  return {
    version,
    parentVersion: "0.1.0",
    architecture: "eadwyn-lm/seed-124m",
    checkpoint: {
      uri: "store://checkpoints/rounds/r/candidates/c/merged.safetensors",
      sha256: "b".repeat(64),
      bytes: 33_000,
    },
    mergeCandidateId: "a1b2c3d4-0004-4000-8000-000000000001",
    changelog: "first federated merge",
    license: "Apache-2.0",
    publishedAt: new Date().toISOString(),
  };
}

/** A Pod that speaks the edge's own contract, counting how often it is asked. */
export function fakePod() {
  let calls = 0;
  const fetchImpl = (async (_input: RequestInfo | URL, init: RequestInit = {}) => {
    calls += 1;
    const { prompt } = JSON.parse(String(init.body)) as { prompt: string };
    return Response.json({
      modelVersion: "0.1.0",
      output: `pod says: ${prompt}`,
      usage: { promptTokens: 3, completionTokens: 3 },
      latencyMs: 5,
      backend: "workers-ai",
      model: "eadwyn-lm/seed-124m",
      mock: false,
    });
  }) as typeof fetch;
  return { fetchImpl, calls: () => calls };
}

edgeContract(async () => {
  const pod = fakePod();
  const app = createInferenceEdgeApp({
    registry: createModelRegistry({
      store: createMemoryStore(registryCodec(() => genesisRegistry())),
    }),
    backend: createUpstreamBackend({ url: "https://pod.eadwyn.test", fetch: pod.fetchImpl }),
    cache: createMemoryCache(),
    fetchPublished: async () => publishedModel("0.2.0"),
    logger,
    operatorToken: "operator-token-0123456789",
  });
  return {
    call: async (path, init = {}, caller = "public") => {
      const headers = new Headers(init.headers);
      headers.set(CALLER_HEADER, caller);
      return app.request(path, { ...init, headers });
    },
    initialVersion: "0.1.0",
    publishedVersion: "0.2.0",
    backend: "upstream",
    operatorToken: "operator-token-0123456789",
  };
});

describe("backends", () => {
  const served = publishedModel("0.3.0");

  it("calls Workers AI with the Eadwyn system prompt and adapter", async () => {
    const calls: unknown[] = [];
    const backend = createWorkersAiBackend({
      model: "@cf/mistral/mistral-7b-instruct-v0.2-lora",
      adapter: "eadwyn-0-3-0",
      run: async (model, inputs) => {
        calls.push({ model, inputs });
        return {
          response: "Nodes learn locally.",
          usage: { prompt_tokens: 41, completion_tokens: 4 },
        };
      },
    });
    const answer = await backend.infer({ prompt: "What stays local?", maxTokens: 64, served });
    expect(answer).toMatchObject({
      output: "Nodes learn locally.",
      backend: "workers-ai",
      adapter: "eadwyn-0-3-0",
      mock: false,
      usage: { promptTokens: 41, completionTokens: 4 },
      modelVersion: "0.3.0",
    });
    expect(calls[0]).toMatchObject({
      model: "@cf/mistral/mistral-7b-instruct-v0.2-lora",
      inputs: {
        max_tokens: 64,
        lora: "eadwyn-0-3-0",
        messages: [{ role: "system" }, { role: "user", content: "What stays local?" }],
      },
    });
  });

  it("labels mock answers and never caches them", async () => {
    const app = createInferenceEdgeApp({
      registry: createModelRegistry({
        store: createMemoryStore(registryCodec(() => genesisRegistry())),
      }),
      backend: createMockBackend(),
      cache: createMemoryCache(),
      logger,
    });
    const ask = async () =>
      (await (
        await app.request("/v1/infer", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt: "hi" }),
        })
      ).json()) as { mock: boolean; cached: boolean };
    expect(await ask()).toMatchObject({ mock: true, cached: false });
    expect(await ask()).toMatchObject({ mock: true, cached: false });
  });

  it("authenticates to a Pod behind Cloudflare Access", async () => {
    let headers: Headers | undefined;
    const backend = createUpstreamBackend({
      url: "https://pod.eadwyn.test",
      accessClientId: "id.access",
      accessClientSecret: "secret",
      fetch: (async (_input: RequestInfo | URL, init: RequestInit = {}) => {
        headers = new Headers(init.headers);
        return Response.json({
          modelVersion: "0.3.0",
          output: "ok",
          usage: { promptTokens: 1, completionTokens: 1 },
          latencyMs: 1,
          backend: "mock",
          mock: false,
        });
      }) as typeof fetch,
    });
    const answer = await backend.infer({ prompt: "x", maxTokens: 8, served });
    expect(answer.backend).toBe("upstream");
    expect(headers?.get("cf-access-client-id")).toBe("id.access");
    expect(headers?.get("cf-access-client-secret")).toBe("secret");
  });
});
