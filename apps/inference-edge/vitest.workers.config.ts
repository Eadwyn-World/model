import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Runs the edge contract inside workerd: D1 served registry, KV cache, a
// stand-in coordinator behind COORDINATOR_INTERNAL, and a fake Pod GPU
// reached through outbound fetch. Workers AI needs a Cloudflare account, so
// its backend is covered by the Node unit tests with a fake binding.
export default defineConfig(async () => {
  const migrations = await readD1Migrations(
    fileURLToPath(new URL("./migrations", import.meta.url)),
  );
  const coordinator = async (request: Request) => {
    if (new URL(request.url).pathname !== "/v1/model/current") {
      return Response.json({ error: { code: "not_found", message: "stand-in" } }, { status: 404 });
    }
    return Response.json({
      version: "0.2.0",
      parentVersion: "0.1.0",
      architecture: "eadwyn-lm/seed-124m",
      checkpoint: {
        uri: "store://checkpoints/x/merged.safetensors",
        sha256: "b".repeat(64),
        bytes: 33_000,
      },
      mergeCandidateId: "a1b2c3d4-0004-4000-8000-000000000001",
      changelog: "first federated merge",
      license: "Apache-2.0",
      publishedAt: new Date().toISOString(),
    });
  };
  // Any outbound fetch the Worker makes lands here: this is the "Pod".
  const pod = async (request: Request) => {
    const { prompt } = (await request.json()) as { prompt: string };
    return Response.json({
      modelVersion: "0.1.0",
      output: `pod says: ${prompt}`,
      usage: { promptTokens: 3, completionTokens: 3 },
      latencyMs: 5,
      backend: "workers-ai",
      model: "eadwyn-lm/seed-124m",
      mock: false,
    });
  };
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        remoteBindings: false,
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            INFERENCE_BACKEND: "upstream",
            UPSTREAM_INFERENCE_URL: "https://pod.eadwyn.test",
            OPERATOR_TOKEN: "operator-token-0123456789",
          },
          serviceBindings: { COORDINATOR_INTERNAL: coordinator },
          outboundService: pod,
        },
      }),
    ],
    test: { include: ["test/workers/**/*.test.ts"] },
  };
});
