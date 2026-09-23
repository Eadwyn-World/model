/**
 * demo-round — one federated training round, end to end, against the local
 * services. Run `pnpm dev:services` (or `pnpm dev`) first, then `pnpm demo:round`.
 *
 *   1. three mock nodes register with the coordinator
 *   2. each prepares a signed local update and submits it to the aggregator
 *   3. the aggregator folds the round into a merge candidate and forwards it
 *   4. two reviewers approve; governance asks the coordinator to publish
 *   5. the coordinator publishes the next version and opens the next round
 *
 * Nothing here is real machine learning. It is the contract flow, exercised.
 */
import {
  createFederationClient,
  DEFAULT_FEDERATION_URLS,
  FederationApiError,
  waitForHealthy,
} from "@eadwyn/federation-sdk";
import type { NodeCapabilities, NodeRole } from "@eadwyn/shared-protocol";
import { createLocalNode } from "@eadwyn/training-runtime";

const urls = {
  coordinatorUrl: process.env.COORDINATOR_URL ?? DEFAULT_FEDERATION_URLS.coordinatorUrl,
  aggregatorUrl: process.env.AGGREGATOR_URL ?? DEFAULT_FEDERATION_URLS.aggregatorUrl,
  governanceUrl: process.env.GOVERNANCE_URL ?? DEFAULT_FEDERATION_URLS.governanceUrl,
  inferenceEdgeUrl: process.env.INFERENCE_EDGE_URL ?? DEFAULT_FEDERATION_URLS.inferenceEdgeUrl,
};

const teal = (text: string) => `\x1b[36m${text}\x1b[0m`;
const dim = (text: string) => `\x1b[2m${text}\x1b[0m`;
const step = (n: number, text: string) => console.log(`\n${teal(`${n}.`)} ${text}`);
const line = (text: string) => console.log(`   ${text}`);

const DEMO_NODES: {
  displayName: string;
  role: NodeRole;
  podId?: string;
  seed: number;
  samples: number;
  capabilities: NodeCapabilities;
}[] = [
  {
    displayName: "Catalyst Pod · Demo",
    role: "pod",
    podId: "pod-demo",
    seed: 101,
    samples: 1_800,
    capabilities: { compute: "gpu", memoryGb: 48 },
  },
  {
    displayName: "Home node · Demo laptop",
    role: "home",
    seed: 202,
    samples: 420,
    capabilities: { compute: "cpu", memoryGb: 16 },
  },
  {
    displayName: "Field device · Demo soil probe",
    role: "device",
    podId: "pod-demo",
    seed: 303,
    samples: 96,
    capabilities: { compute: "edge", memoryGb: 2 },
  },
];

async function main() {
  const client = createFederationClient({ ...urls, timeoutMs: 8_000 });

  step(0, "Waiting for the services");
  await Promise.all([
    waitForHealthy("coordinator", client.coordinator.health),
    waitForHealthy("aggregator", client.aggregator.health),
    waitForHealthy("governance", client.governance.health),
  ]);
  const before = await client.coordinator.getStats();
  line(
    `global model ${teal(`v${before.globalModelVersion}`)} · round ${before.activeRound.number} (${before.activeRound.status}) · ${before.registeredNodes} nodes`,
  );

  step(1, "Nodes register with the coordinator");
  const nodes = DEMO_NODES.map((config) =>
    createLocalNode({
      ...config,
      region: "demo",
      coordinatorUrl: urls.coordinatorUrl,
      aggregatorUrl: urls.aggregatorUrl,
    }),
  );
  for (const node of nodes) {
    const { node: identity, activeRound } = await node.registerNode();
    line(
      `${identity.displayName.padEnd(32)} ${dim(identity.nodeId)} → round ${activeRound.number}, base v${activeRound.baseModelVersion}`,
    );
  }

  step(2, "Nodes learn locally and submit signed updates (only learning travels)");
  for (const [i, node] of nodes.entries()) {
    const config = DEMO_NODES[i];
    if (!config) continue;
    const { update, delta } = await node.prepareLocalUpdate({
      samples: config.samples,
      knowledgeItemIds: ["ki-0004", "ki-0011"],
    });
    const receipt = await node.submitUpdate(update);
    line(
      `${config.displayName.padEnd(32)} loss ${update.metrics.lossBefore.toFixed(3)} → ${update.metrics.lossAfter.toFixed(3)} on ${config.samples} samples · delta ${(delta.byteLength / 1024).toFixed(0)} KiB · ${receipt.verification}`,
    );
  }

  const round = nodes[0]?.activeRound;
  if (!round) throw new Error("no active round after registration");

  step(3, "The aggregator folds the round into a merge candidate");
  const { candidate, forwardedToGovernance } = await client.aggregator.createMergeCandidate({
    roundId: round.roundId,
    method: "fedavg",
  });
  line(`${candidate.summary}`);
  line(
    `candidate ${dim(candidate.candidateId)} · checkpoint sha256 ${dim(candidate.checkpoint.sha256.slice(0, 16))}… · proposed v${candidate.proposedVersion}`,
  );
  if (!forwardedToGovernance) {
    line("governance did not receive it automatically; submitting directly");
    await client.governance.submitCandidate(candidate);
  }

  step(4, "Reviewers decide (governed merge)");
  const reviewers = [
    {
      reviewerId: "reviewer-ash",
      rationale:
        "Loss improved on every demo node; provenance lists accepted knowledge items only.",
    },
    { reviewerId: "reviewer-mara", rationale: "Signatures verified; no node contributed twice." },
  ];
  let review = await client.governance.getMerge(candidate.candidateId);
  for (const reviewer of reviewers) {
    const decision = await client.governance.decide(candidate.candidateId, {
      ...reviewer,
      verdict: "approve",
    });
    review = decision.review;
    line(
      `${reviewer.reviewerId.padEnd(16)} approve → ${review.tally.approvals}/${review.tally.approvalQuorum} approvals · candidate ${review.candidate.status}`,
    );
  }

  step(5, "The mind rebalances");
  if (review.publishedVersion) {
    const after = await client.coordinator.getStats();
    line(`published ${teal(`v${review.publishedVersion}`)} (was v${before.globalModelVersion})`);
    line(
      `round ${after.activeRound.number} is now ${after.activeRound.status} on base v${after.activeRound.baseModelVersion} · ${after.registeredNodes} nodes registered`,
    );
    try {
      const served = await client.inferenceEdge.getModel();
      line(
        dim(
          `inference edge still serves v${served.version}; pulling published versions to the edge is the next milestone`,
        ),
      );
    } catch {
      line(dim("inference edge is not running; skip"));
    }
    console.log(
      `\nOpen http://localhost:3000 — the federation panel now shows v${review.publishedVersion}.\n`,
    );
  } else {
    line(`approved but not published: ${review.publishError ?? "coordinator did not confirm"}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  if (error instanceof FederationApiError) {
    console.error(`\n${error.code} (${error.status}) ${error.message}`);
  } else {
    console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  }
  console.error("Is the stack running? Start it with `pnpm dev:services` in another terminal.");
  process.exit(1);
});
