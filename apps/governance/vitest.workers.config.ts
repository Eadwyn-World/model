import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Runs the governance contract inside workerd: per-merge Durable Objects,
// the D1 projection, Cloudflare Access verification (with keys minted here),
// and a stand-in coordinator behind the COORDINATOR_INTERNAL service binding.
export default defineConfig(async () => {
  const migrations = await readD1Migrations(
    fileURLToPath(new URL("./migrations", import.meta.url)),
  );
  const pair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const publicJwk = {
    ...(await crypto.subtle.exportKey("jwk", pair.publicKey)),
    kid: "test",
    alg: "RS256",
  };
  const privateJwk = {
    ...(await crypto.subtle.exportKey("jwk", pair.privateKey)),
    kid: "test",
    alg: "RS256",
  };

  // The stand-in coordinator fails the first publish of any candidate whose id
  // ends in "f00d", so the alarm-driven retry can be observed.
  const failedOnce = new Set<string>();
  const coordinator = async (request: Request) => {
    const url = new URL(request.url);
    if (url.pathname !== "/v1/model/publish" || request.method !== "POST") {
      return Response.json(
        { error: { code: "not_found", message: url.pathname } },
        { status: 404 },
      );
    }
    const body = (await request.json()) as { candidateId: string };
    if (body.candidateId.endsWith("f00d") && !failedOnce.has(body.candidateId)) {
      failedOnce.add(body.candidateId);
      return Response.json(
        { error: { code: "unavailable", message: "coordinator restarting" } },
        { status: 503 },
      );
    }
    const now = new Date().toISOString();
    return Response.json(
      {
        model: {
          version: "0.4.0",
          parentVersion: "0.3.1",
          architecture: "eadwyn-lm/seed-124m",
          checkpoint: { uri: "store://checkpoints/x", sha256: "a".repeat(64), bytes: 1 },
          mergeCandidateId: body.candidateId,
          changelog: "published by the stand-in coordinator",
          license: "Apache-2.0",
          publishedAt: now,
        },
        nextRound: {
          roundId: "a1b2c3d4-0002-4000-8000-000000000042",
          number: 42,
          baseModelVersion: "0.4.0",
          status: "collecting",
          startedAt: now,
          expectedNodes: 16,
          participatingNodeIds: [],
          updatesReceived: 0,
        },
      },
      { status: 201 },
    );
  };

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            REVIEWER_AUTH: "access",
            ACCESS_TEAM_DOMAIN: "eadwyn.cloudflareaccess.com",
            ACCESS_AUD: "governance-aud",
            ACCESS_JWKS: JSON.stringify({ keys: [publicJwk] }),
            TEST_ACCESS_PRIVATE_JWK: JSON.stringify(privateJwk),
          },
          serviceBindings: { COORDINATOR_INTERNAL: coordinator },
        },
      }),
    ],
    test: { include: ["test/workers/**/*.test.ts"] },
  };
});
