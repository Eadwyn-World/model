import { RegisterNodeRequestSchema, TrainingUpdateSchema } from "@eadwyn/shared-protocol";
import { sampleNodeIdentity, sampleTrainingRound } from "@eadwyn/shared-protocol/fixtures";
import { verifyTrainingUpdateSignature } from "@eadwyn/shared-protocol/signing";
import { decodeSafetensors } from "@eadwyn/weights";
import { describe, expect, it } from "vitest";
import { simulateLocalTraining } from "../mock-training";
import { createLocalNode } from "../node";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("local node runtime", () => {
  it("registers, uploads a real adapter delta, and submits a verifiable signed update", async () => {
    const submitted: unknown[] = [];
    const uploads: Uint8Array[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname === "/v1/nodes/register") {
        const body = RegisterNodeRequestSchema.parse(JSON.parse(String(init.body)));
        return json({
          node: {
            ...sampleNodeIdentity(),
            ...body,
            nodeId: "a1b2c3d4-0001-4000-8000-000000000099",
          },
          activeRound: sampleTrainingRound(),
        });
      }
      if (url.pathname === "/v1/updates/upload-target") {
        const body = JSON.parse(String(init.body)) as { updateId: string; roundId: string };
        return json({
          mode: "direct",
          uri: `store://deltas/rounds/${body.roundId}/updates/${body.updateId}.safetensors`,
          method: "PUT",
          url: `http://aggregator.test/v1/deltas/${body.roundId}/${body.updateId}?token=t`,
          headers: {},
          maxBytes: 1_000_000,
        });
      }
      if (url.pathname.startsWith("/v1/deltas/")) {
        uploads.push(new Uint8Array(init.body as ArrayBuffer));
        return json({ ok: true }, 201);
      }
      if (url.pathname === "/v1/updates") {
        submitted.push(JSON.parse(String(init.body)));
        return json({
          accepted: true,
          updateId: (submitted[0] as { updateId: string }).updateId,
          receivedAt: new Date().toISOString(),
          verification: "verified",
        });
      }
      return json({ error: { code: "not_found", message: url.pathname } }, 404);
    }) as typeof fetch;

    const node = createLocalNode({
      displayName: "Test laptop",
      role: "home",
      coordinatorUrl: "http://coordinator.test",
      aggregatorUrl: "http://aggregator.test",
      seed: 7,
      fetch: fetchImpl,
    });

    await expect(node.prepareLocalUpdate({ samples: 10 })).rejects.toThrow(/not registered/);

    const registration = await node.registerNode();
    expect(registration.node.publicKey).toBe(node.keyPair.publicKey);

    const prepared = await node.prepareLocalUpdate({ samples: 320, knowledgeItemIds: ["ki-0004"] });
    const { update, delta } = prepared;
    expect(TrainingUpdateSchema.safeParse(update).success).toBe(true);
    expect(update.delta.uri).toBe(
      `store://deltas/rounds/${update.roundId}/updates/${update.updateId}.safetensors`,
    );
    expect(update.delta.bytes).toBe(delta.byteLength);
    expect(Object.keys(decodeSafetensors(delta).tensors)).toHaveLength(16);
    expect(update.metrics.lossAfter).toBeLessThan(update.metrics.lossBefore);
    expect(await verifyTrainingUpdateSignature(update, node.keyPair.publicKey)).toBe(true);

    const receipt = await node.submitUpdate(prepared);
    expect(receipt.accepted).toBe(true);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.byteLength).toBe(delta.byteLength);
    expect(submitted).toHaveLength(1);
  });

  it("simulates training deterministically from a seed", async () => {
    const a = await simulateLocalTraining({ seed: 42, samples: 100, steps: 20 });
    const b = await simulateLocalTraining({ seed: 42, samples: 100, steps: 20 });
    const c = await simulateLocalTraining({ seed: 43, samples: 100, steps: 20 });
    expect(a.sha256).toBe(b.sha256);
    expect(a.sha256).not.toBe(c.sha256);
    expect(a.metrics).toEqual(b.metrics);
  });
});
