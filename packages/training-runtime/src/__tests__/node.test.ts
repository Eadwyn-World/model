import { RegisterNodeRequestSchema, TrainingUpdateSchema } from "@eadwyn/shared-protocol";
import { sampleNodeIdentity, sampleTrainingRound } from "@eadwyn/shared-protocol/fixtures";
import { verifyTrainingUpdateSignature } from "@eadwyn/shared-protocol/signing";
import { describe, expect, it } from "vitest";
import { simulateLocalTraining } from "../mock-training";
import { createLocalNode } from "../node";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("local node runtime", () => {
  it("registers, prepares a verifiable signed update and submits it", async () => {
    const submitted: unknown[] = [];
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

    const { update, delta } = await node.prepareLocalUpdate({
      samples: 320,
      knowledgeItemIds: ["ki-0004"],
    });
    expect(TrainingUpdateSchema.safeParse(update).success).toBe(true);
    expect(update.roundId).toBe(sampleTrainingRound().roundId);
    expect(update.baseModelVersion).toBe("0.3.1");
    expect(update.delta.bytes).toBe(delta.byteLength);
    expect(update.metrics.lossAfter).toBeLessThan(update.metrics.lossBefore);
    expect(verifyTrainingUpdateSignature(update, node.keyPair.publicKey)).toBe(true);

    const receipt = await node.submitUpdate(update);
    expect(receipt.accepted).toBe(true);
    expect(submitted).toHaveLength(1);
  });

  it("simulates training deterministically from a seed", () => {
    const a = simulateLocalTraining({ seed: 42, samples: 100, steps: 20 });
    const b = simulateLocalTraining({ seed: 42, samples: 100, steps: 20 });
    const c = simulateLocalTraining({ seed: 43, samples: 100, steps: 20 });
    expect(a.sha256).toBe(b.sha256);
    expect(a.sha256).not.toBe(c.sha256);
    expect(a.metrics).toEqual(b.metrics);
  });
});
