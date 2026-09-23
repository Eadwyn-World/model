/**
 * Aggregator contract, shared by Node (JSON document, filesystem objects,
 * in-process pipeline) and Cloudflare (D1, R2, Queue, Workflow).
 */
import {
  DeltaUploadTargetSchema,
  HealthResponseSchema,
  type MergeCandidateDetail,
  MergeCandidateDetailSchema,
  MergeCandidateResponseSchema,
  SubmitUpdateResponseSchema,
  type TrainingUpdate,
  type UnsignedTrainingUpdate,
} from "@eadwyn/shared-protocol";
import { type NodeKeyPair, signTrainingUpdate } from "@eadwyn/shared-protocol/signing";
import { simulateLocalTraining } from "@eadwyn/training-runtime";
import { describe, expect, it } from "vitest";

export type Caller = "public" | "internal";
export type Call = (path: string, init?: RequestInit, caller?: Caller) => Promise<Response>;

export interface TestNode {
  nodeId: string;
  keys: NodeKeyPair;
}

export interface AggregatorHarness {
  call: Call;
  /** Two nodes the coordinator (real or stand-in) knows. */
  nodes: [TestNode, TestNode];
  roundId: string;
  operatorToken: string;
  /** Resolves once the merge pipeline for this candidate has finished (either way). */
  settle(candidateId: string): Promise<MergeCandidateDetail>;
  /** Candidate ids governance has received. */
  forwarded(): Promise<string[]>;
  /** Update ids the coordinator was told about (eventually, on Cloudflare). */
  progressReports(): Promise<string[]>;
}

const jsonInit = (
  method: string,
  body: unknown,
  headers: Record<string, string> = {},
): RequestInit => ({
  method,
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

async function waitFor<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    value = await read();
  }
  return value;
}

export function aggregatorContract(setup: () => Promise<AggregatorHarness>) {
  describe("aggregator contract", () => {
    async function prepare(h: AggregatorHarness, node: TestNode, seed: number) {
      const trained = await simulateLocalTraining({ seed, samples: 200 + seed * 100, steps: 40 });
      const updateId = crypto.randomUUID();
      const request = {
        updateId,
        roundId: h.roundId,
        nodeId: node.nodeId,
        sha256: trained.sha256,
        bytes: trained.delta.byteLength,
      };
      const targetRes = await h.call("/v1/updates/upload-target", jsonInit("POST", request));
      expect(targetRes.status).toBe(201);
      const target = DeltaUploadTargetSchema.parse(await targetRes.json());
      const unsigned: UnsignedTrainingUpdate = {
        updateId,
        nodeId: node.nodeId,
        roundId: h.roundId,
        baseModelVersion: "0.3.1",
        delta: { uri: target.uri, sha256: trained.sha256, bytes: trained.delta.byteLength },
        metrics: trained.metrics,
        knowledgeItemIds: [],
        createdAt: new Date().toISOString(),
      };
      const update: TrainingUpdate = {
        ...unsigned,
        signature: await signTrainingUpdate(unsigned, node.keys.privateKey),
      };
      return { trained, target, update };
    }

    async function upload(
      h: AggregatorHarness,
      target: { url?: string; headers: Record<string, string> },
      bytes: Uint8Array,
    ) {
      const url = new URL(target.url as string);
      return h.call(`${url.pathname}${url.search}`, {
        method: "PUT",
        headers: target.headers,
        body: bytes.slice(),
      });
    }

    it("reports health and its upload mode", async () => {
      const h = await setup();
      const health = HealthResponseSchema.parse(await (await h.call("/health")).json());
      expect(health.status).toBe("ok");
      expect(health.details).toMatchObject({ uploads: "direct", verifySignatures: true });
    });

    it("takes a delta upload, then the signed update that references it", async () => {
      const h = await setup();
      const [node] = h.nodes;
      const { trained, target, update } = await prepare(h, node, 1);
      expect(target.mode).toBe("direct");
      expect(target.uri).toBe(
        `store://deltas/rounds/${h.roundId}/updates/${update.updateId}.safetensors`,
      );

      // Submitting before uploading: refused.
      const early = await h.call("/v1/updates", jsonInit("POST", update));
      expect(early.status).toBe(400);
      expect(await early.json()).toMatchObject({ error: { code: "delta_missing" } });

      const forged = new URL(target.url as string);
      forged.searchParams.set("token", "forged");
      expect(
        (
          await h.call(`${forged.pathname}${forged.search}`, {
            method: "PUT",
            body: trained.delta.slice(),
          })
        ).status,
      ).toBe(401);

      const wrongBytes = trained.delta.slice();
      wrongBytes[100] = (wrongBytes[100] ?? 0) ^ 0xff;
      const tampered = await upload(h, target, wrongBytes);
      expect(tampered.status).toBe(400);
      expect(await tampered.json()).toMatchObject({ error: { code: "delta_mismatch" } });

      expect((await upload(h, target, trained.delta)).status).toBe(201);
      const accepted = await h.call("/v1/updates", jsonInit("POST", update));
      expect(accepted.status).toBe(201);
      expect(SubmitUpdateResponseSchema.parse(await accepted.json()).verification).toBe("verified");

      const replay = await h.call("/v1/updates", jsonInit("POST", update));
      expect(replay.status).toBe(409);
      expect(await replay.json()).toMatchObject({ error: { code: "duplicate_update" } });

      const second = await prepare(h, node, 2);
      await upload(h, second.target, second.trained.delta);
      const again = await h.call("/v1/updates", jsonInit("POST", second.update));
      expect(again.status).toBe(409);
      expect(await again.json()).toMatchObject({ error: { code: "node_already_submitted" } });

      const reports = await waitFor(h.progressReports, (ids) => ids.includes(update.updateId));
      expect(reports).toContain(update.updateId);
    });

    it("refuses tampered, misplaced, oversized and malformed updates", async () => {
      const h = await setup();
      const [, node] = h.nodes;
      const { trained, target, update } = await prepare(h, node, 3);
      await upload(h, target, trained.delta);

      const tampered = { ...update, metrics: { ...update.metrics, samples: 999_999 } };
      expect((await h.call("/v1/updates", jsonInit("POST", tampered))).status).toBe(401);

      const misplaced = {
        ...update,
        delta: { ...update.delta, uri: "store://deltas/rounds/elsewhere.safetensors" },
      };
      const misplacedRes = await h.call("/v1/updates", jsonInit("POST", misplaced));
      expect(misplacedRes.status).toBe(400);
      expect(await misplacedRes.json()).toMatchObject({ error: { code: "delta_not_uploaded" } });

      const unknownNode = await h.call(
        "/v1/updates/upload-target",
        jsonInit("POST", {
          updateId: crypto.randomUUID(),
          roundId: h.roundId,
          nodeId: crypto.randomUUID(),
          sha256: "a".repeat(64),
          bytes: 10,
        }),
      );
      expect(unknownNode.status).toBe(403);

      const huge = await h.call(
        "/v1/updates/upload-target",
        jsonInit("POST", {
          updateId: crypto.randomUUID(),
          roundId: h.roundId,
          nodeId: node.nodeId,
          sha256: "a".repeat(64),
          bytes: 10 ** 9,
        }),
      );
      expect(huge.status).toBe(400);

      const malformed = await h.call("/v1/updates", jsonInit("POST", { hello: "world" }));
      expect(malformed.status).toBe(400);
      expect(await malformed.json()).toMatchObject({ error: { code: "invalid_payload" } });
    });

    it("aggregates a round for operators only and forwards the merged candidate", async () => {
      const h = await setup();
      const submitted: string[] = [];
      for (const [index, node] of h.nodes.entries()) {
        const { trained, target, update } = await prepare(h, node, 10 + index);
        expect((await upload(h, target, trained.delta)).status).toBe(201);
        expect((await h.call("/v1/updates", jsonInit("POST", update))).status).toBe(201);
        submitted.push(update.updateId);
      }
      const reported = await waitFor(h.progressReports, (ids) =>
        submitted.every((id) => ids.includes(id)),
      );
      expect(submitted.every((id) => reported.includes(id))).toBe(true);

      expect((await h.call("/v1/merges", jsonInit("POST", { roundId: h.roundId }))).status).toBe(
        401,
      );
      const created = await h.call(
        "/v1/merges",
        jsonInit(
          "POST",
          { roundId: h.roundId, method: "fedavg" },
          { authorization: `Bearer ${h.operatorToken}` },
        ),
      );
      expect(created.status).toBe(201);
      const { candidate, pipeline } = MergeCandidateResponseSchema.parse(await created.json());
      expect(pipeline?.status).toBe("queued");
      expect(candidate.updateIds).toHaveLength(2);
      expect(candidate.manifest?.uri).toMatch(/manifest\.json$/);

      const settled = await h.settle(candidate.candidateId);
      expect(settled.pipeline?.status).toBe("forwarded");
      expect(settled.candidate.checkpoint.uri).toMatch(/merged\.safetensors$/);
      expect(settled.candidate.checkpoint.sha256).not.toBe(candidate.manifest?.sha256);
      expect(settled.pipeline?.steps.map((s) => s.name)).toEqual([
        "aggregate",
        "record-checkpoint",
        "forward-to-governance",
      ]);
      expect(await h.forwarded()).toContain(candidate.candidateId);

      const detail = MergeCandidateDetailSchema.parse(
        await (await h.call(`/v1/merges/${candidate.candidateId}`)).json(),
      );
      expect(detail.candidate.checkpoint.uri).toBe(settled.candidate.checkpoint.uri);

      const empty = await h.call(
        "/v1/merges",
        jsonInit(
          "POST",
          { roundId: crypto.randomUUID() },
          { authorization: `Bearer ${h.operatorToken}` },
        ),
      );
      expect(empty.status).toBe(400);
      expect(await empty.json()).toMatchObject({ error: { code: "no_updates" } });
    });
  });
}
