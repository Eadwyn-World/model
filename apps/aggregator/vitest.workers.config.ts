import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Runs the aggregator contract inside workerd: D1 (constraints), R2 (direct
// uploads with digest verification), the Queue consumer, and the MergePipeline
// Workflow with inline aggregation. The coordinator and governance are
// stand-ins behind the same service bindings the real Workers use.
export default defineConfig(async () => {
  const migrations = await readD1Migrations(
    fileURLToPath(new URL("./migrations", import.meta.url)),
  );
  const b64 = (buffer: ArrayBuffer) => Buffer.from(buffer).toString("base64");
  const nodes = await Promise.all(
    [1, 2].map(async (n) => {
      const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
        "sign",
        "verify",
      ])) as CryptoKeyPair;
      return {
        nodeId: `a1b2c3d4-0001-4000-8000-00000000000${n}`,
        publicKey: b64(await crypto.subtle.exportKey("spki", pair.publicKey)),
        privateKey: b64(await crypto.subtle.exportKey("pkcs8", pair.privateKey)),
      };
    }),
  );

  const progress: string[] = [];
  const coordinator = async (request: Request) => {
    const url = new URL(request.url);
    if (url.pathname === "/__progress") return Response.json({ updateIds: progress });
    const nodeMatch = /^\/v1\/nodes\/([^/]+)$/.exec(url.pathname);
    if (request.method === "GET" && nodeMatch) {
      const node = nodes.find((n) => n.nodeId === nodeMatch[1]);
      if (!node)
        return Response.json(
          { error: { code: "not_found", message: "node not found" } },
          { status: 404 },
        );
      return Response.json({
        nodeId: node.nodeId,
        displayName: "Test node",
        role: "home",
        publicKey: node.publicKey,
        capabilities: { compute: "cpu" },
        registeredAt: new Date().toISOString(),
      });
    }
    if (request.method === "POST" && url.pathname === "/v1/rounds/active/progress") {
      const body = (await request.json()) as { roundId: string; nodeId: string; updateId: string };
      progress.push(body.updateId);
      return Response.json({
        round: {
          roundId: body.roundId,
          number: 1,
          baseModelVersion: "0.3.1",
          status: "collecting",
          startedAt: new Date().toISOString(),
          expectedNodes: 2,
          participatingNodeIds: [body.nodeId],
          updatesReceived: progress.length,
        },
      });
    }
    return Response.json({ error: { code: "not_found", message: url.pathname } }, { status: 404 });
  };

  const received: string[] = [];
  const governance = async (request: Request) => {
    const url = new URL(request.url);
    if (url.pathname === "/__received") return Response.json({ candidateIds: received });
    if (request.method === "POST" && url.pathname === "/v1/merges") {
      const candidate = (await request.json()) as { candidateId: string };
      received.push(candidate.candidateId);
      return Response.json({ candidate }, { status: 201 });
    }
    return Response.json({ error: { code: "not_found", message: url.pathname } }, { status: 404 });
  };

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            TEST_NODES: JSON.stringify(nodes),
            OPERATOR_TOKEN: "operator-token-0123456789",
            UPLOAD_TOKEN_SECRET: "test-upload-secret-0123456789",
            AGGREGATOR_MAX_DELTA_BYTES: "1048576",
          },
          serviceBindings: { COORDINATOR_INTERNAL: coordinator, GOVERNANCE_INTERNAL: governance },
        },
      }),
    ],
    test: { include: ["test/workers/**/*.test.ts"], testTimeout: 30_000 },
  };
});
