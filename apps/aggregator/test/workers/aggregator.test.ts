import { applyD1Migrations, env, introspectWorkflow } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { MergeCandidateDetailSchema } from "@eadwyn/shared-protocol";
import { afterEach, beforeAll } from "vitest";
import {
  type AggregatorHarness,
  aggregatorContract,
  type Call,
} from "../../src/__tests__/contract";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

// The pool tracks Workflow instances per test; disposing releases them cleanly.
let workflows: Awaited<ReturnType<typeof introspectWorkflow>> | undefined;
afterEach(async () => {
  await workflows?.dispose();
  workflows = undefined;
});

const call: Call = (path, init = {}, caller = "public") => {
  const request = new Request(`https://aggregator.test${path}`, init);
  return caller === "internal"
    ? exports.InternalApi.fetch(request)
    : exports.default.fetch(request);
};

aggregatorContract(async (): Promise<AggregatorHarness> => {
  workflows = await introspectWorkflow(env.MERGE_PIPELINE);
  const nodes = (
    JSON.parse(env.TEST_NODES) as { nodeId: string; publicKey: string; privateKey: string }[]
  ).map((n) => ({
    nodeId: n.nodeId,
    keys: { publicKey: n.publicKey, privateKey: n.privateKey },
  })) as AggregatorHarness["nodes"];
  return {
    call,
    nodes,
    // A fresh round per test keeps "one update per node per round" independent between tests.
    roundId: crypto.randomUUID(),
    operatorToken: "operator-token-0123456789",
    async settle(candidateId) {
      const deadline = Date.now() + 20_000;
      for (;;) {
        const detail = MergeCandidateDetailSchema.parse(
          await (await call(`/v1/merges/${candidateId}`)).json(),
        );
        const status = detail.pipeline?.status;
        if (status === "forwarded" || status === "failed" || Date.now() > deadline) {
          // Let the Workflow engine finish recording the instance before the test ends.
          for (const instance of (await workflows?.get()) ?? []) {
            await instance.waitForStatus(status === "failed" ? "errored" : "complete");
          }
          return detail;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    },
    forwarded: async () =>
      (
        (await (
          await env.GOVERNANCE_INTERNAL.fetch("https://governance.test/__received")
        ).json()) as { candidateIds: string[] }
      ).candidateIds,
    progressReports: async () =>
      (
        (await (
          await env.COORDINATOR_INTERNAL.fetch("https://coordinator.test/__progress")
        ).json()) as { updateIds: string[] }
      ).updateIds,
  };
});
