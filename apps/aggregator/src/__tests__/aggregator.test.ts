import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "@eadwyn/service-kit";
import {
  MergeCandidateResponseSchema,
  SubmitUpdateResponseSchema,
  type TrainingUpdate,
  type UnsignedTrainingUpdate,
} from "@eadwyn/shared-protocol";
import { FIXTURE_IDS } from "@eadwyn/shared-protocol/fixtures";
import { generateNodeKeyPair, signTrainingUpdate } from "@eadwyn/shared-protocol/signing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAggregatorApp } from "../app";
import { createAggregatorStore } from "../state";

const NODE_ID = "a1b2c3d4-0001-4000-8000-000000000777";
const keys = generateNodeKeyPair();

function signedUpdate(overrides: Partial<UnsignedTrainingUpdate> = {}): TrainingUpdate {
  const unsigned: UnsignedTrainingUpdate = {
    updateId: "a1b2c3d4-0003-4000-8000-000000000777",
    nodeId: NODE_ID,
    roundId: FIXTURE_IDS.round,
    baseModelVersion: "0.3.1",
    delta: { uri: "local://x/delta", sha256: "c".repeat(64), bytes: 2048 },
    metrics: { samples: 400, steps: 50, lossBefore: 2.4, lossAfter: 2.2, wallClockSeconds: 60 },
    knowledgeItemIds: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
  return { ...unsigned, signature: signTrainingUpdate(unsigned, keys.privateKey) };
}

let dir: string;
let progress: unknown[];
let forwarded: unknown[];
let app: ReturnType<typeof createAggregatorApp>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "eadwyn-aggregator-"));
  progress = [];
  forwarded = [];
  app = createAggregatorApp({
    store: createAggregatorStore(join(dir, "aggregator.json")),
    logger: createLogger({ service: "aggregator-test", level: "error" }),
    config: { maxDeltaBytes: 1024 * 1024, verifySignatures: true },
    resolvePublicKey: async (nodeId) => (nodeId === NODE_ID ? keys.publicKey : null),
    onUpdateAccepted: async (u) => {
      progress.push(u.updateId);
    },
    forwardCandidate: async (candidate) => {
      forwarded.push(candidate.candidateId);
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

describe("POST /v1/updates", () => {
  it("accepts a correctly signed update once and reports progress", async () => {
    const update = signedUpdate();
    const res = await post("/v1/updates", update);
    expect(res.status).toBe(201);
    const receipt = SubmitUpdateResponseSchema.parse(await res.json());
    expect(receipt.verification).toBe("verified");
    expect(progress).toEqual([update.updateId]);

    const replay = await post("/v1/updates", update);
    expect(replay.status).toBe(409);
    expect(await replay.json()).toMatchObject({ error: { code: "duplicate_update" } });

    const secondFromSameNode = await post(
      "/v1/updates",
      signedUpdate({ updateId: "a1b2c3d4-0003-4000-8000-000000000778" }),
    );
    expect(secondFromSameNode.status).toBe(409);
    expect(await secondFromSameNode.json()).toMatchObject({
      error: { code: "node_already_submitted" },
    });
  });

  it("rejects tampering, unknown nodes, oversized deltas and malformed payloads", async () => {
    const tampered = { ...signedUpdate(), metrics: { ...signedUpdate().metrics, samples: 9_999 } };
    expect((await post("/v1/updates", tampered)).status).toBe(401);

    const unknown = signedUpdate({ nodeId: "a1b2c3d4-0001-4000-8000-000000000778" });
    expect((await post("/v1/updates", unknown)).status).toBe(403);

    const huge = signedUpdate({
      delta: { uri: "local://x", sha256: "d".repeat(64), bytes: 1024 * 1024 * 8 },
    });
    expect((await post("/v1/updates", huge)).status).toBe(400);

    const malformed = await post("/v1/updates", { hello: "world" });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: { code: "invalid_payload" } });
  });
});

describe("POST /v1/merges", () => {
  it("folds a round's updates into a pending candidate and forwards it", async () => {
    await post("/v1/updates", signedUpdate());
    const res = await post("/v1/merges", { roundId: FIXTURE_IDS.round });
    expect(res.status).toBe(201);
    const { candidate, forwardedToGovernance } = MergeCandidateResponseSchema.parse(
      await res.json(),
    );
    expect(forwardedToGovernance).toBe(true);
    expect(forwarded).toEqual([candidate.candidateId]);
    expect(candidate.status).toBe("pending");
    expect(candidate.baseModelVersion).toBe("0.3.1");
    expect(candidate.proposedVersion).toBe("0.4.0");
    expect(candidate.updateIds).toHaveLength(97); // 96 seeded + 1 new
    expect(candidate.aggregation.method).toBe("fedavg");
    expect(candidate.aggregation.weightedLossAfter).toBeGreaterThan(0);

    const empty = await post("/v1/merges", { roundId: "a1b2c3d4-0002-4000-8000-000000000099" });
    expect(empty.status).toBe(400);
    expect(await empty.json()).toMatchObject({ error: { code: "no_updates" } });
  });
});
