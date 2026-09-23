import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "@eadwyn/service-kit";
import {
  DecisionResponseSchema,
  MergeReviewListResponseSchema,
  ReviewerListResponseSchema,
} from "@eadwyn/shared-protocol";
import { FIXTURE_IDS, sampleMergeCandidate } from "@eadwyn/shared-protocol/fixtures";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGovernanceApp } from "../app";
import { createGovernanceStore } from "../state";

let dir: string;
let published: string[];
let app: ReturnType<typeof createGovernanceApp>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "eadwyn-governance-"));
  published = [];
  app = createGovernanceApp({
    store: createGovernanceStore(join(dir, "governance.json")),
    logger: createLogger({ service: "governance-test", level: "error" }),
    config: { approvalQuorum: 2, rejectionQuorum: 1 },
    publish: async (candidate) => {
      published.push(candidate.candidateId);
      return { version: "0.4.0" };
    },
  });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const post = (path: string, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("GET /v1/merges", () => {
  it("lists pending merges by default with their tally", async () => {
    const res = await app.request("/v1/merges");
    expect(res.status).toBe(200);
    const { merges, total } = MergeReviewListResponseSchema.parse(await res.json());
    expect(total).toBe(2);
    expect(merges.every((m) => m.candidate.status === "pending")).toBe(true);
    const fedavg = merges.find((m) => m.candidate.candidateId === FIXTURE_IDS.candidate);
    expect(fedavg?.tally).toMatchObject({ approvals: 1, rejections: 0, approvalQuorum: 2 });

    const all = MergeReviewListResponseSchema.parse(
      await (await app.request("/v1/merges?status=all")).json(),
    );
    expect(all.total).toBe(4);
    expect(all.merges.find((m) => m.candidate.status === "published")?.publishedVersion).toBe(
      "0.3.1",
    );
  });
});

describe("POST /v1/merges/:id/decisions", () => {
  it("approves at quorum, publishes, and refuses further decisions", async () => {
    const first = await post(`/v1/merges/${FIXTURE_IDS.candidateAlt}/decisions`, {
      reviewerId: "reviewer-mara",
      verdict: "approve",
      rationale: "Median is robust to the two noisy lab updates.",
    });
    expect(first.status).toBe(201);
    expect(DecisionResponseSchema.parse(await first.json()).review.candidate.status).toBe(
      "pending",
    );

    const again = await post(`/v1/merges/${FIXTURE_IDS.candidateAlt}/decisions`, {
      reviewerId: "reviewer-mara",
      verdict: "approve",
      rationale: "duplicate",
    });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: { code: "already_decided" } });

    const second = await post(`/v1/merges/${FIXTURE_IDS.candidateAlt}/decisions`, {
      reviewerId: "reviewer-ash",
      verdict: "approve",
      rationale: "Agreed.",
    });
    expect(second.status).toBe(201);
    const review = DecisionResponseSchema.parse(await second.json()).review;
    expect(review.candidate.status).toBe("published");
    expect(review.publishedVersion).toBe("0.4.0");
    expect(published).toEqual([FIXTURE_IDS.candidateAlt]);

    const late = await post(`/v1/merges/${FIXTURE_IDS.candidateAlt}/decisions`, {
      reviewerId: "reviewer-tomas",
      verdict: "reject",
      rationale: "too late",
    });
    expect(late.status).toBe(409);
    expect(await late.json()).toMatchObject({ error: { code: "merge_not_pending" } });
  });

  it("rejects on a single rejection and records reviewer activity", async () => {
    const res = await post(`/v1/merges/${FIXTURE_IDS.candidate}/decisions`, {
      reviewerId: "reviewer-tomas",
      verdict: "reject",
      rationale: "Loss regression on the northern terraces eval set.",
    });
    expect(res.status).toBe(201);
    expect(DecisionResponseSchema.parse(await res.json()).review.candidate.status).toBe("rejected");
    expect(published).toEqual([]);

    const reviewers = ReviewerListResponseSchema.parse(
      await (await app.request("/v1/reviewers")).json(),
    );
    expect(reviewers.reviewers.find((r) => r.reviewerId === "reviewer-tomas")).toMatchObject({
      decisions: 1,
      rejections: 1,
    });
  });

  it("accepts a new candidate from the aggregator as pending and refuses duplicates", async () => {
    const candidate = {
      ...sampleMergeCandidate(),
      candidateId: "a1b2c3d4-0004-4000-8000-000000000777",
      status: "approved",
    };
    const res = await post("/v1/merges", candidate);
    expect(res.status).toBe(201);
    expect(((await res.json()) as { candidate: { status: string } }).candidate.status).toBe(
      "pending",
    );
    expect((await post("/v1/merges", candidate)).status).toBe(409);
    expect((await post("/v1/merges", { nope: true })).status).toBe(400);
  });
});
