/**
 * Governance contract, shared by the Node backend (one document) and the
 * Cloudflare backend (a Durable Object per merge + D1 projection). Starts
 * from an empty queue: candidates arrive the way the aggregator sends them.
 */
import {
  DecisionListResponseSchema,
  DecisionResponseSchema,
  HealthResponseSchema,
  MergeReviewListResponseSchema,
  MergeReviewSchema,
  ReviewerListResponseSchema,
} from "@eadwyn/shared-protocol";
import { sampleMergeCandidate } from "@eadwyn/shared-protocol/fixtures";
import { describe, expect, it } from "vitest";

export type Caller = "public" | "internal";
export type Call = (path: string, init?: RequestInit, caller?: Caller) => Promise<Response>;

export interface ReviewerAuth {
  /** Headers that identify `reviewerId` (an Access JWT on Cloudflare, nothing on Node). */
  headers(reviewerId: string): Promise<Record<string, string>>;
  /** Whether the body must name the reviewer (true when authentication is off). */
  bodyNamesReviewer: boolean;
}

export interface GovernanceHarness {
  call: Call;
  auth: ReviewerAuth;
  /** The version the stub coordinator assigns when asked to publish. */
  publishedVersion: string;
}

const json = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

const candidateId = (n: number) => `a1b2c3d4-0004-4000-8000-${String(n).padStart(12, "0")}`;
const candidate = (n: number) => ({ ...sampleMergeCandidate(), candidateId: candidateId(n) });

export function governanceContract(setup: () => Promise<GovernanceHarness>) {
  describe("governance contract", () => {
    async function decide(
      h: GovernanceHarness,
      id: string,
      reviewerId: string,
      verdict: "approve" | "reject",
    ) {
      const body = {
        ...(h.auth.bodyNamesReviewer ? { reviewerId } : {}),
        verdict,
        rationale: `${reviewerId} says ${verdict}`,
      };
      return h.call(`/v1/merges/${id}/decisions`, json(body, await h.auth.headers(reviewerId)));
    }

    it("accepts candidates only from internal callers, always as pending", async () => {
      const h = await setup();
      expect(HealthResponseSchema.parse(await (await h.call("/health")).json()).status).toBe("ok");
      expect(
        MergeReviewListResponseSchema.parse(await (await h.call("/v1/merges")).json()).total,
      ).toBe(0);

      expect((await h.call("/v1/merges", json(candidate(1)), "public")).status).toBe(403);
      const created = await h.call(
        "/v1/merges",
        json({ ...candidate(1), status: "approved" }),
        "internal",
      );
      expect(created.status).toBe(201);
      expect(((await created.json()) as { candidate: { status: string } }).candidate.status).toBe(
        "pending",
      );

      const duplicate = await h.call("/v1/merges", json(candidate(1)), "internal");
      expect(duplicate.status).toBe(409);
      expect(await duplicate.json()).toMatchObject({ error: { code: "duplicate_candidate" } });
      expect((await h.call("/v1/merges", json({ nope: true }), "internal")).status).toBe(400);

      await h.call("/v1/merges", json(candidate(2)), "internal");
      const pending = MergeReviewListResponseSchema.parse(
        await (await h.call("/v1/merges")).json(),
      );
      expect(pending.merges.map((m) => m.candidate.candidateId).sort()).toEqual([
        candidateId(1),
        candidateId(2),
      ]);
      const one = MergeReviewSchema.parse(
        await (await h.call(`/v1/merges/${candidateId(1)}`)).json(),
      );
      expect(one.tally).toMatchObject({ approvals: 0, rejections: 0, approvalQuorum: 2 });
      expect((await h.call(`/v1/merges/${candidateId(99)}`)).status).toBe(404);
    });

    it("approves at quorum, publishes once, and refuses further decisions", async () => {
      const h = await setup();
      await h.call("/v1/merges", json(candidate(3)), "internal");

      const first = await decide(h, candidateId(3), "reviewer-mara", "approve");
      expect(first.status).toBe(201);
      expect(DecisionResponseSchema.parse(await first.json()).review.candidate.status).toBe(
        "pending",
      );

      const again = await decide(h, candidateId(3), "reviewer-mara", "approve");
      expect(again.status).toBe(409);
      expect(await again.json()).toMatchObject({ error: { code: "already_decided" } });

      const second = await decide(h, candidateId(3), "reviewer-ash", "approve");
      expect(second.status).toBe(201);
      const review = DecisionResponseSchema.parse(await second.json()).review;
      expect(review.candidate.status).toBe("published");
      expect(review.publishedVersion).toBe(h.publishedVersion);
      expect(review.decisions.map((d) => d.reviewerId).sort()).toEqual([
        "reviewer-ash",
        "reviewer-mara",
      ]);

      const late = await decide(h, candidateId(3), "reviewer-tomas", "reject");
      expect(late.status).toBe(409);
      expect(await late.json()).toMatchObject({ error: { code: "merge_not_pending" } });
      expect((await decide(h, candidateId(98), "reviewer-ash", "approve")).status).toBe(404);

      const published = MergeReviewListResponseSchema.parse(
        await (await h.call("/v1/merges?status=published")).json(),
      );
      expect(published.merges.map((m) => m.candidate.candidateId)).toEqual([candidateId(3)]);
    });

    it("rejects on a single rejection and keeps a queryable decision log", async () => {
      const h = await setup();
      await h.call("/v1/merges", json(candidate(4)), "internal");
      const res = await decide(h, candidateId(4), "reviewer-tomas", "reject");
      expect(res.status).toBe(201);
      const review = DecisionResponseSchema.parse(await res.json()).review;
      expect(review.candidate.status).toBe("rejected");
      expect(review.publishedVersion).toBeUndefined();

      const all = MergeReviewListResponseSchema.parse(
        await (await h.call("/v1/merges?status=all")).json(),
      );
      expect(
        all.merges.find((m) => m.candidate.candidateId === candidateId(4))?.candidate.status,
      ).toBe("rejected");

      const decisions = DecisionListResponseSchema.parse(
        await (await h.call("/v1/decisions?reviewerId=reviewer-tomas")).json(),
      );
      expect(decisions.decisions).toHaveLength(1);
      expect(decisions.decisions[0]).toMatchObject({
        verdict: "reject",
        candidateId: candidateId(4),
      });

      const reviewers = ReviewerListResponseSchema.parse(
        await (await h.call("/v1/reviewers")).json(),
      );
      expect(reviewers.reviewers.find((r) => r.reviewerId === "reviewer-tomas")).toMatchObject({
        decisions: 1,
        rejections: 1,
      });
    });

    it("requires a reviewer identity", async () => {
      const h = await setup();
      await h.call("/v1/merges", json(candidate(5)), "internal");
      const anonymous = await h.call(
        `/v1/merges/${candidateId(5)}/decisions`,
        json({ verdict: "approve", rationale: "who am I?" }),
      );
      expect([400, 401]).toContain(anonymous.status);
    });
  });
}
