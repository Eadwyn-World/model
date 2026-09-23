import { applyD1Migrations, env, reset, runDurableObjectAlarm } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { DecisionResponseSchema, MergeReviewSchema } from "@eadwyn/shared-protocol";
import { sampleMergeCandidate } from "@eadwyn/shared-protocol/fixtures";
import { sign } from "hono/jwt";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Call, governanceContract } from "../../src/__tests__/contract";

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
afterEach(async () => {
  await reset();
});

const call: Call = (path, init = {}, caller = "public") => {
  const request = new Request(`https://governance.test${path}`, init);
  return caller === "internal"
    ? exports.InternalApi.fetch(request)
    : exports.default.fetch(request);
};

async function accessToken(email: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign(
    {
      iss: "https://eadwyn.cloudflareaccess.com",
      aud: ["governance-aud"],
      email,
      sub: email,
      iat: now,
      exp: now + 300,
    },
    JSON.parse(env.TEST_ACCESS_PRIVATE_JWK),
    "RS256",
  );
}

// Same contract as Node, but reviewers are proven by Cloudflare Access tokens.
governanceContract(async () => ({
  call,
  auth: {
    headers: async (reviewerId) => ({ "cf-access-jwt-assertion": await accessToken(reviewerId) }),
    bodyNamesReviewer: false,
  },
  publishedVersion: "0.4.0",
}));

describe("Cloudflare-specific behaviour", () => {
  it("retries a failed publish from the merge's Durable Object alarm", async () => {
    const candidateId = "a1b2c3d4-0004-4000-8000-00000000f00d";
    await call(
      "/v1/merges",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...sampleMergeCandidate(), candidateId }),
      },
      "internal",
    );
    const approve = async (email: string) =>
      call(`/v1/merges/${candidateId}/decisions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-access-jwt-assertion": await accessToken(email),
        },
        body: JSON.stringify({ verdict: "approve", rationale: "ok" }),
      });
    await approve("ash@eadwyn.world");
    const second = DecisionResponseSchema.parse(await (await approve("mara@eadwyn.world")).json());
    expect(second.review).toMatchObject({
      publishRetrying: true,
      candidate: { status: "approved" },
    });

    const stub = env.MERGE_REVIEWS.get(env.MERGE_REVIEWS.idFromName(candidateId));
    expect(await runDurableObjectAlarm(stub)).toBe(true);

    const after = MergeReviewSchema.parse(await (await call(`/v1/merges/${candidateId}`)).json());
    expect(after).toMatchObject({ publishedVersion: "0.4.0", candidate: { status: "published" } });
    const listed = (await (await call("/v1/merges?status=published")).json()) as { total: number };
    expect(listed.total).toBe(1);
  });

  it("refuses a forged Access token", async () => {
    const candidateId = "a1b2c3d4-0004-4000-8000-00000000beef";
    await call(
      "/v1/merges",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...sampleMergeCandidate(), candidateId }),
      },
      "internal",
    );
    const forged = (await accessToken("ash@eadwyn.world")).replace(/\.[^.]+$/, ".AAAA");
    const res = await call(`/v1/merges/${candidateId}/decisions`, {
      method: "POST",
      headers: { "content-type": "application/json", "cf-access-jwt-assertion": forged },
      body: JSON.stringify({ verdict: "approve", rationale: "sneaky" }),
    });
    expect(res.status).toBe(401);
  });
});
