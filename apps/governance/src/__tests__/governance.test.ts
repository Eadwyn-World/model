import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CALLER_HEADER, createLogger, createMemoryStore } from "@eadwyn/service-kit";
import { createFileStore } from "@eadwyn/service-kit/node";
import { MergeReviewListResponseSchema } from "@eadwyn/shared-protocol";
import { FIXTURE_IDS, sampleMergeCandidate } from "@eadwyn/shared-protocol/fixtures";
import type { Hono } from "hono";
import { sign } from "hono/jwt";
import { afterEach, describe, expect, it } from "vitest";
import { createGovernanceApp } from "../app";
import { createDocumentGovernanceBackend } from "../backend";
import { createReviewerResolver } from "../reviewers";
import { governanceCodec } from "../state";
import { governanceContract } from "./contract";

const logger = createLogger({ service: "governance-test", level: "error" });
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function stamp(app: Hono) {
  return async (path: string, init: RequestInit = {}, caller: "public" | "internal" = "public") => {
    const headers = new Headers(init.headers);
    headers.set(CALLER_HEADER, caller);
    return app.request(path, { ...init, headers });
  };
}

governanceContract(async () => {
  const dir = await mkdtemp(join(tmpdir(), "eadwyn-governance-"));
  dirs.push(dir);
  const backend = createDocumentGovernanceBackend({
    store: createFileStore({
      filePath: join(dir, "governance.json"),
      ...governanceCodec("genesis"),
    }),
    quorums: { approvalQuorum: 2, rejectionQuorum: 1 },
    publish: async () => ({ version: "0.4.0" }),
    logger,
  });
  const app = createGovernanceApp({
    backend,
    resolveReviewer: createReviewerResolver({ mode: "none" }),
    logger,
  });
  return {
    call: stamp(app),
    auth: { headers: async () => ({}), bodyNamesReviewer: true },
    publishedVersion: "0.4.0",
  };
});

describe("fixture world (local development)", () => {
  it("lists the seeded pending merges", async () => {
    const backend = createDocumentGovernanceBackend({
      store: createMemoryStore(governanceCodec("fixtures")),
      quorums: { approvalQuorum: 2, rejectionQuorum: 1 },
      logger,
    });
    const app = createGovernanceApp({
      backend,
      resolveReviewer: createReviewerResolver({ mode: "none" }),
      logger,
    });
    const { merges, total } = MergeReviewListResponseSchema.parse(
      await (await app.request("/v1/merges")).json(),
    );
    expect(total).toBe(2);
    expect(
      merges.find((m) => m.candidate.candidateId === FIXTURE_IDS.candidate)?.tally.approvals,
    ).toBe(1);
  });
});

describe("publishing when the coordinator is down", () => {
  it("records a retryable failure and publishes on retry", async () => {
    let coordinatorUp = false;
    const backend = createDocumentGovernanceBackend({
      store: createMemoryStore(governanceCodec("genesis")),
      quorums: { approvalQuorum: 1, rejectionQuorum: 1 },
      publish: async () => {
        if (!coordinatorUp)
          throw Object.assign(new Error("coordinator unreachable"), { status: 0 });
        return { version: "0.4.0" };
      },
      logger,
    });
    const candidate = {
      ...sampleMergeCandidate(),
      candidateId: "a1b2c3d4-0004-4000-8000-000000000777",
    };
    await backend.submitCandidate(candidate);
    const { review } = await backend.decide(candidate.candidateId, {
      reviewerId: "reviewer-ash",
      verdict: "approve",
      rationale: "ok",
    });
    expect(review).toMatchObject({
      publishError: "coordinator unreachable",
      publishRetrying: true,
    });
    expect(review.candidate.status).toBe("approved");

    expect(await backend.retryPendingPublications()).toBe(1);
    coordinatorUp = true;
    expect(await backend.retryPendingPublications()).toBe(0);
    expect(await backend.getReview(candidate.candidateId)).toMatchObject({
      publishedVersion: "0.4.0",
      candidate: { status: "published" },
    });
  });

  it("stops retrying when the base version went stale", async () => {
    const backend = createDocumentGovernanceBackend({
      store: createMemoryStore(governanceCodec("genesis")),
      quorums: { approvalQuorum: 1, rejectionQuorum: 1 },
      publish: async () => {
        throw Object.assign(new Error("cannot publish on 0.3.1"), { status: 409 });
      },
      logger,
    });
    const candidate = {
      ...sampleMergeCandidate(),
      candidateId: "a1b2c3d4-0004-4000-8000-000000000778",
    };
    await backend.submitCandidate(candidate);
    const { review } = await backend.decide(candidate.candidateId, {
      reviewerId: "r",
      verdict: "approve",
      rationale: "ok",
    });
    expect(review.publishRetrying).toBe(false);
    expect(await backend.retryPendingPublications()).toBe(0);
  });
});

describe("Cloudflare Access reviewers", () => {
  it("takes the reviewer from a verified Access token and ignores the body", async () => {
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
      kid: "k",
      alg: "RS256",
    };
    const privateJwk = {
      ...(await crypto.subtle.exportKey("jwk", pair.privateKey)),
      kid: "k",
      alg: "RS256",
    };
    const backend = createDocumentGovernanceBackend({
      store: createMemoryStore(governanceCodec("genesis")),
      quorums: { approvalQuorum: 2, rejectionQuorum: 1 },
      logger,
    });
    const app = createGovernanceApp({
      backend,
      resolveReviewer: createReviewerResolver({
        mode: "access",
        teamDomain: "eadwyn.cloudflareaccess.com",
        audience: "aud",
        jwks: JSON.stringify({ keys: [publicJwk] }),
      }),
      logger,
    });
    const candidate = {
      ...sampleMergeCandidate(),
      candidateId: "a1b2c3d4-0004-4000-8000-000000000779",
    };
    await backend.submitCandidate(candidate);
    const url = `/v1/merges/${candidate.candidateId}/decisions`;
    const body = JSON.stringify({ reviewerId: "impostor", verdict: "approve", rationale: "lgtm" });

    expect(
      (
        await app.request(url, {
          method: "POST",
          body,
          headers: { "content-type": "application/json" },
        })
      ).status,
    ).toBe(401);

    const now = Math.floor(Date.now() / 1000);
    const token = await sign(
      {
        iss: "https://eadwyn.cloudflareaccess.com",
        aud: ["aud"],
        email: "mara@eadwyn.world",
        sub: "u",
        iat: now,
        exp: now + 60,
      },
      privateJwk as never,
      "RS256",
    );
    const res = await app.request(url, {
      method: "POST",
      body,
      headers: { "content-type": "application/json", "cf-access-jwt-assertion": token },
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { decision: { reviewerId: string } }).decision.reviewerId).toBe(
      "mara@eadwyn.world",
    );

    const misconfigured = createGovernanceApp({
      backend,
      resolveReviewer: createReviewerResolver({ mode: "access" }),
      logger,
    });
    expect(
      (
        await misconfigured.request(url, {
          method: "POST",
          body,
          headers: { "content-type": "application/json" },
        })
      ).status,
    ).toBe(503);
  });
});
