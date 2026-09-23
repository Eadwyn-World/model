/**
 * Inference edge contract, shared by Node and Cloudflare. The harness decides
 * the backend; both runs use an upstream "Pod" so the cache path is real.
 */
import {
  EdgeSyncResponseSchema,
  HealthResponseSchema,
  InferenceResponseSchema,
  ModelVersionSchema,
} from "@eadwyn/shared-protocol";
import { describe, expect, it } from "vitest";

export type Caller = "public" | "internal";
export type Call = (path: string, init?: RequestInit, caller?: Caller) => Promise<Response>;

export interface EdgeHarness {
  call: Call;
  initialVersion: string;
  /** What the (stand-in) coordinator reports as published. */
  publishedVersion: string;
  backend: "mock" | "workers-ai" | "upstream";
  operatorToken: string;
}

const post = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

export function edgeContract(setup: () => Promise<EdgeHarness>) {
  describe("inference edge contract", () => {
    it("reports what it serves and how", async () => {
      const h = await setup();
      const health = HealthResponseSchema.parse(await (await h.call("/health")).json());
      expect(health.details).toMatchObject({
        servedModelVersion: h.initialVersion,
        backend: h.backend,
      });
      const model = ModelVersionSchema.parse(await (await h.call("/v1/model")).json());
      expect(model.version).toBe(h.initialVersion);
    });

    it("answers, labels the answer, caches real answers, and validates input", async () => {
      const h = await setup();
      const first = InferenceResponseSchema.parse(
        await (
          await h.call("/v1/infer", post({ prompt: "How does the mind rebalance?", maxTokens: 32 }))
        ).json(),
      );
      expect(first).toMatchObject({
        modelVersion: h.initialVersion,
        backend: h.backend,
        cached: false,
      });
      expect(first.output.length).toBeGreaterThan(0);

      const second = InferenceResponseSchema.parse(
        await (
          await h.call("/v1/infer", post({ prompt: "How does the mind rebalance?", maxTokens: 32 }))
        ).json(),
      );
      expect(second.cached).toBe(!first.mock);
      expect(second.output).toBe(first.output);

      expect((await h.call("/v1/infer", post({ prompt: "" }))).status).toBe(400);
    });

    it("adopts the coordinator's published version on sync, for operators only", async () => {
      const h = await setup();
      expect((await h.call("/v1/sync", post({}))).status).toBe(401);

      const synced = EdgeSyncResponseSchema.parse(
        await (
          await h.call("/v1/sync", post({}, { authorization: `Bearer ${h.operatorToken}` }))
        ).json(),
      );
      expect(synced).toMatchObject({
        adopted: true,
        servedVersion: h.publishedVersion,
        coordinatorVersion: h.publishedVersion,
      });
      expect(ModelVersionSchema.parse(await (await h.call("/v1/model")).json()).version).toBe(
        h.publishedVersion,
      );

      const again = EdgeSyncResponseSchema.parse(
        await (await h.call("/v1/sync", post({}), "internal")).json(),
      );
      expect(again.adopted).toBe(false);

      const answer = InferenceResponseSchema.parse(
        await (await h.call("/v1/infer", post({ prompt: "hello" }))).json(),
      );
      // A new served version is a new cache namespace.
      expect(answer.cached).toBe(false);
      if (h.backend !== "upstream") {
        // The edge labels its own answers; an upstream Pod reports the version it actually ran.
        expect(answer.modelVersion).toBe(h.publishedVersion);
      }
    });
  });
}
