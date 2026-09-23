/**
 * Deterministic sample data for every contract.
 *
 * Used by the web app's mock mode, the service seeds and the tests, so all of
 * them tell the same story: model 0.3.1 is live, round 41 is collecting with
 * 96 of 128 nodes reporting, and two merge candidates are in review.
 */
import type { StoredUpdate } from "./api";
import type { FederationStats } from "./federation";
import type { GovernanceDecision } from "./governance";
import type { MergeCandidate } from "./merge";
import type { ModelVersion } from "./model";
import type { NodeIdentity } from "./node";
import { hexFrom, mulberry32 } from "./prng";
import type { TrainingRound, TrainingUpdate } from "./training";

export const FIXTURE_IDS = {
  node: "a1b2c3d4-0001-4000-8000-000000000001",
  round: "a1b2c3d4-0002-4000-8000-000000000041",
  previousRound: "a1b2c3d4-0002-4000-8000-000000000040",
  update: "a1b2c3d4-0003-4000-8000-000000000001",
  /** Pending fedavg candidate for round 41. */
  candidate: "a1b2c3d4-0004-4000-8000-00000000041a",
  /** Pending median candidate for round 41. */
  candidateAlt: "a1b2c3d4-0004-4000-8000-00000000041b",
  /** The candidate that became 0.3.1. */
  publishedCandidate: "a1b2c3d4-0004-4000-8000-00000000040a",
  /** A rejected round-40 candidate. */
  rejectedCandidate: "a1b2c3d4-0004-4000-8000-00000000040b",
  decision: "a1b2c3d4-0005-4000-8000-000000000001",
} as const;

export const FIXTURE_NODE_COUNT = 128;
export const FIXTURE_ONLINE_NODE_COUNT = 71;
export const FIXTURE_UPDATE_COUNT = 96;
export const MOCK_CHECKPOINT_BYTES = 249_561_088;

/** A valid-looking Ed25519 SPKI public key (base64) for fixtures only. */
export const FIXTURE_PUBLIC_KEY = "MCowBQYDK2VwAyEAGb9ECWmEzf6FQbrBZ9w7lshQhqowtrbLDFw4rXAxZuE=";

const minutesAgo = (now: Date, minutes: number) =>
  new Date(now.getTime() - minutes * 60_000).toISOString();
const daysAgo = (now: Date, days: number) => minutesAgo(now, days * 24 * 60);
const fixtureUuid = (group: string, index: number) =>
  `a1b2c3d4-${group}-4000-8000-${String(index).padStart(12, "0")}`;

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export function sampleModelVersion(now = new Date()): ModelVersion {
  return {
    version: "0.3.1",
    parentVersion: "0.3.0",
    architecture: "eadwyn-lm/seed-124m",
    parameterCount: 124_000_000,
    checkpoint: {
      uri: "eadwyn://checkpoints/0.3.1/model.safetensors",
      sha256: "6f1a3c1e9b2d4f5a7c8e9d0b1a2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4",
      bytes: MOCK_CHECKPOINT_BYTES,
    },
    mergeCandidateId: FIXTURE_IDS.publishedCandidate,
    changelog: "Round 40 merge: field notes from 61 nodes; corrections to the harvest calendar.",
    license: "Apache-2.0",
    publishedAt: minutesAgo(now, 2 * 24 * 60 + 37),
  };
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

const PODS = [
  { id: "pod-riverside", name: "Riverside", region: "eu-west", nodes: 14 },
  { id: "pod-north-terraces", name: "North Terraces", region: "eu-north", nodes: 12 },
  { id: "pod-canal-district", name: "Canal District", region: "eu-west", nodes: 10 },
  { id: "pod-saltmarsh", name: "Saltmarsh", region: "us-east", nodes: 9 },
  { id: "pod-high-orchard", name: "High Orchard", region: "ap-south", nodes: 8 },
  { id: "pod-tidewater", name: "Tidewater", region: "sa-east", nodes: 7 },
] as const;

const HOME_PLACES = ["Riverside", "North Terraces", "Canal District", "Saltmarsh", "Tidewater"];
const DEVICE_KINDS = ["canal sensor", "soil probe", "rooftop farm", "microgrid meter"];

function fixturePublicKey(random: () => number): string {
  // 12-byte SPKI prefix for Ed25519 followed by 32 key bytes.
  const prefix = Buffer.from("302a300506032b6570032100", "hex");
  const key = Buffer.from(hexFrom(random, 64), "hex");
  return Buffer.concat([prefix, key]).toString("base64");
}

/** 128 deterministic nodes: 60 across six Catalyst Pods, 48 homes, 16 field devices, 4 labs. */
export function sampleNodeIdentities(now = new Date()): NodeIdentity[] {
  const random = mulberry32(128);
  const nodes: NodeIdentity[] = [];
  const push = (partial: Omit<NodeIdentity, "nodeId" | "publicKey" | "registeredAt">) => {
    const index = nodes.length + 1;
    nodes.push({
      nodeId: fixtureUuid("0001", index),
      publicKey: index === 1 ? FIXTURE_PUBLIC_KEY : fixturePublicKey(random),
      registeredAt: daysAgo(now, 30 + Math.floor(random() * 90)),
      ...partial,
    });
  };

  for (const pod of PODS) {
    for (let i = 1; i <= pod.nodes; i += 1) {
      push({
        displayName: `Catalyst Pod · ${pod.name}${i === 1 ? "" : ` · gpu-${String(i).padStart(2, "0")}`}`,
        role: "pod",
        podId: pod.id,
        region: pod.region,
        capabilities: {
          compute: "gpu",
          memoryGb: 24 + 24 * (i % 3),
          maxUpdateBytes: 64 * 1024 * 1024,
        },
      });
    }
  }
  for (let i = 1; i <= 48; i += 1) {
    const place = HOME_PLACES[i % HOME_PLACES.length] ?? "Riverside";
    push({
      displayName: `Home node · ${place} ${String(i).padStart(2, "0")}`,
      role: "home",
      region: PODS[i % PODS.length]?.region,
      capabilities: {
        compute: i % 4 === 0 ? "gpu" : "cpu",
        memoryGb: 8 + 8 * (i % 3),
        maxUpdateBytes: 16 * 1024 * 1024,
      },
    });
  }
  for (let i = 1; i <= 16; i += 1) {
    const kind = DEVICE_KINDS[i % DEVICE_KINDS.length] ?? "field device";
    push({
      displayName: `Field device · ${kind} ${String(i).padStart(2, "0")}`,
      role: "device",
      podId: PODS[i % PODS.length]?.id,
      region: PODS[i % PODS.length]?.region,
      capabilities: { compute: "edge", memoryGb: 2, maxUpdateBytes: 2 * 1024 * 1024 },
    });
  }
  for (let i = 1; i <= 4; i += 1) {
    push({
      displayName: `Lab cluster · ${["Tidewater", "Riverside", "High Orchard", "Saltmarsh"][i - 1]}`,
      role: "lab",
      region: PODS[(i * 2) % PODS.length]?.region,
      capabilities: { compute: "gpu", memoryGb: 160, maxUpdateBytes: 256 * 1024 * 1024 },
    });
  }

  // 71 nodes were seen recently (the first one four minutes ago); the rest
  // went quiet hours or days ago. A deterministic shuffle picks which.
  const order = nodes.map((_, i) => i).slice(1);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = order[i] as number;
    order[i] = order[j] as number;
    order[j] = a;
  }
  order.forEach((nodeIndex, position) => {
    const node = nodes[nodeIndex] as NodeIdentity;
    node.lastSeenAt =
      position < FIXTURE_ONLINE_NODE_COUNT - 1
        ? minutesAgo(now, 1 + Math.floor(random() * 240))
        : minutesAgo(now, 8 * 60 + Math.floor(random() * 5 * 24 * 60));
  });
  const first = nodes[0];
  if (first) {
    first.lastSeenAt = minutesAgo(now, 4);
  }
  return nodes;
}

export function sampleNodeIdentity(now = new Date()): NodeIdentity {
  const first = sampleNodeIdentities(now)[0];
  if (!first) {
    throw new Error("fixture nodes are empty");
  }
  return first;
}

// ---------------------------------------------------------------------------
// Rounds and updates
// ---------------------------------------------------------------------------

export function sampleTrainingRound(now = new Date()): TrainingRound {
  return {
    roundId: FIXTURE_IDS.round,
    number: 41,
    baseModelVersion: "0.3.1",
    status: "collecting",
    startedAt: minutesAgo(now, 6 * 60 + 12),
    expectedNodes: FIXTURE_NODE_COUNT,
    participatingNodeIds: Array.from({ length: FIXTURE_UPDATE_COUNT }, (_, i) =>
      fixtureUuid("0001", i + 1),
    ),
    updatesReceived: FIXTURE_UPDATE_COUNT,
  };
}

export function samplePreviousTrainingRound(now = new Date()): TrainingRound {
  return {
    roundId: FIXTURE_IDS.previousRound,
    number: 40,
    baseModelVersion: "0.3.0",
    status: "published",
    startedAt: daysAgo(now, 3),
    closesAt: minutesAgo(now, 2 * 24 * 60 + 37),
    expectedNodes: FIXTURE_NODE_COUNT,
    participatingNodeIds: Array.from({ length: 61 }, (_, i) => fixtureUuid("0001", i + 1)),
    updatesReceived: 61,
  };
}

const KNOWLEDGE_IDS = [
  "ki-0001",
  "ki-0002",
  "ki-0003",
  "ki-0004",
  "ki-0005",
  "ki-0006",
  "ki-0007",
  "ki-0008",
  "ki-0009",
  "ki-0010",
  "ki-0011",
];

/** 96 stored updates for round 41, one per participating node. Signatures are placeholders (verification: skipped). */
export function sampleStoredUpdates(now = new Date()): StoredUpdate[] {
  const random = mulberry32(96);
  const round = sampleTrainingRound(now);
  const roundStart = new Date(round.startedAt).getTime();
  return round.participatingNodeIds.map((nodeId, i) => {
    const samples = 300 + Math.floor(random() * 1500);
    const steps = Math.max(10, Math.round(samples / 8));
    const lossBefore = Math.round((2.2 + random() * 0.4) * 1000) / 1000;
    const lossAfter = Math.round((lossBefore - 0.1 - random() * 0.2) * 1000) / 1000;
    const createdAt = new Date(roundStart + (i / FIXTURE_UPDATE_COUNT) * (6 * 60 - 4) * 60_000);
    const knowledge = KNOWLEDGE_IDS.filter(() => random() < 0.15);
    const updateId = i === 0 ? FIXTURE_IDS.update : fixtureUuid("0003", i + 1);
    return {
      updateId,
      nodeId,
      roundId: round.roundId,
      baseModelVersion: round.baseModelVersion,
      delta: {
        uri: `local://${nodeId}/rounds/${round.roundId}/${updateId}.safetensors`,
        sha256: hexFrom(random, 64),
        bytes: 64 * 1024 + samples * 96,
      },
      metrics: {
        samples,
        steps,
        lossBefore,
        lossAfter,
        wallClockSeconds: Math.round(steps * (1.2 + random() * 1.5) * 10) / 10,
      },
      knowledgeItemIds: knowledge,
      createdAt: createdAt.toISOString(),
      signature: "seed-fixture-signature-not-verifiable",
      receivedAt: new Date(createdAt.getTime() + 20_000).toISOString(),
      verification: "skipped",
    };
  });
}

export function sampleTrainingUpdate(now = new Date()): TrainingUpdate {
  const first = sampleStoredUpdates(now)[0];
  if (!first) {
    throw new Error("fixture updates are empty");
  }
  const { receivedAt: _receivedAt, verification: _verification, ...update } = first;
  return update;
}

// ---------------------------------------------------------------------------
// Merges and governance
// ---------------------------------------------------------------------------

export function sampleMergeCandidate(now = new Date()): MergeCandidate {
  return {
    candidateId: FIXTURE_IDS.candidate,
    roundId: FIXTURE_IDS.round,
    baseModelVersion: "0.3.1",
    proposedVersion: "0.4.0",
    updateIds: sampleStoredUpdates(now).map((u) => u.updateId),
    aggregation: {
      method: "fedavg",
      participantCount: FIXTURE_UPDATE_COUNT,
      totalSamples: 118_400,
      weightedLossAfter: 2.16,
    },
    checkpoint: {
      uri: `eadwyn://candidates/${FIXTURE_IDS.round}/${FIXTURE_IDS.candidate}.safetensors`,
      sha256: "9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b7a6f5e4d3c2b1a0f9e8d",
      bytes: MOCK_CHECKPOINT_BYTES,
    },
    status: "pending",
    summary:
      "fedavg of 96 updates (118,400 samples) from 96 nodes. Weighted loss 2.16, down from 2.39.",
    createdAt: minutesAgo(now, 55),
  };
}

export interface GovernanceHistory {
  candidates: MergeCandidate[];
  decisions: GovernanceDecision[];
  publications: Record<string, { version?: string; error?: string; at: string }>;
}

/** Four candidates: one published (0.3.1), one rejected, two pending for round 41. */
export function sampleGovernanceHistory(now = new Date()): GovernanceHistory {
  const pending = sampleMergeCandidate(now);
  const published: MergeCandidate = {
    candidateId: FIXTURE_IDS.publishedCandidate,
    roundId: FIXTURE_IDS.previousRound,
    baseModelVersion: "0.3.0",
    proposedVersion: "0.4.0",
    updateIds: Array.from({ length: 61 }, (_, i) => fixtureUuid("0006", i + 1)),
    aggregation: {
      method: "fedavg",
      participantCount: 61,
      totalSamples: 74_210,
      weightedLossAfter: 2.31,
    },
    checkpoint: {
      uri: `eadwyn://candidates/${FIXTURE_IDS.previousRound}/${FIXTURE_IDS.publishedCandidate}.safetensors`,
      sha256: "6f1a3c1e9b2d4f5a7c8e9d0b1a2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4",
      bytes: MOCK_CHECKPOINT_BYTES,
    },
    status: "published",
    summary:
      "fedavg of 61 updates (74,210 samples) from 61 nodes. Weighted loss 2.31, down from 2.52.",
    createdAt: minutesAgo(now, 2 * 24 * 60 + 190),
  };
  const rejected: MergeCandidate = {
    ...published,
    candidateId: FIXTURE_IDS.rejectedCandidate,
    aggregation: {
      method: "trimmed-mean",
      participantCount: 61,
      totalSamples: 74_210,
      weightedLossAfter: 2.47,
    },
    checkpoint: {
      uri: `eadwyn://candidates/${FIXTURE_IDS.previousRound}/${FIXTURE_IDS.rejectedCandidate}.safetensors`,
      sha256: "4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b7a6f5e4d3c",
      bytes: MOCK_CHECKPOINT_BYTES,
    },
    status: "rejected",
    summary:
      "trimmed-mean of 61 updates (74,210 samples) from 61 nodes. Weighted loss 2.47, down from 2.52.",
    createdAt: minutesAgo(now, 2 * 24 * 60 + 185),
  };
  const pendingAlt: MergeCandidate = {
    ...pending,
    candidateId: FIXTURE_IDS.candidateAlt,
    aggregation: {
      method: "median",
      participantCount: FIXTURE_UPDATE_COUNT,
      totalSamples: 118_400,
      weightedLossAfter: 2.19,
    },
    checkpoint: {
      uri: `eadwyn://candidates/${FIXTURE_IDS.round}/${FIXTURE_IDS.candidateAlt}.safetensors`,
      sha256: "0b9a8f7e6d5c4b3a2f1e0d9c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a",
      bytes: MOCK_CHECKPOINT_BYTES,
    },
    summary:
      "median of 96 updates (118,400 samples) from 96 nodes. Weighted loss 2.19, down from 2.39.",
    createdAt: minutesAgo(now, 41),
  };

  const decisions: GovernanceDecision[] = [
    {
      decisionId: fixtureUuid("0005", 10),
      candidateId: published.candidateId,
      reviewerId: "reviewer-ash",
      verdict: "approve",
      rationale: "Loss improved in every region; eval set unchanged on the northern terraces data.",
      createdAt: minutesAgo(now, 2 * 24 * 60 + 120),
    },
    {
      decisionId: fixtureUuid("0005", 11),
      candidateId: published.candidateId,
      reviewerId: "reviewer-mara",
      verdict: "approve",
      rationale: "Provenance complete: 61 signed updates, all knowledge items accepted.",
      createdAt: minutesAgo(now, 2 * 24 * 60 + 60),
    },
    {
      decisionId: fixtureUuid("0005", 12),
      candidateId: rejected.candidateId,
      reviewerId: "reviewer-ash",
      verdict: "reject",
      rationale: "Trimmed mean dropped the two lab updates that carried the harvest corrections.",
      createdAt: minutesAgo(now, 2 * 24 * 60 + 110),
    },
    {
      ...sampleGovernanceDecision(now),
    },
  ];

  return {
    candidates: [published, rejected, pending, pendingAlt],
    decisions,
    publications: {
      [published.candidateId]: { version: "0.3.1", at: minutesAgo(now, 2 * 24 * 60 + 37) },
    },
  };
}

export function sampleGovernanceDecision(now = new Date()): GovernanceDecision {
  return {
    decisionId: FIXTURE_IDS.decision,
    candidateId: FIXTURE_IDS.candidate,
    reviewerId: "reviewer-ash",
    verdict: "approve",
    rationale: "Loss improved across every participating region; no regression on the eval set.",
    createdAt: minutesAgo(now, 20),
  };
}

// ---------------------------------------------------------------------------
// Federation readout
// ---------------------------------------------------------------------------

export function sampleFederationStats(now = new Date()): FederationStats {
  const model = sampleModelVersion(now);
  return {
    globalModelVersion: model.version,
    globalModelPublishedAt: model.publishedAt,
    activeRound: sampleTrainingRound(now),
    registeredNodes: FIXTURE_NODE_COUNT,
    onlineNodes: FIXTURE_ONLINE_NODE_COUNT,
    lastSyncAt: minutesAgo(now, 4),
    generatedAt: now.toISOString(),
  };
}

/** Governance numbers the web page shows next to the coordinator's stats. */
export function sampleGovernanceSummary() {
  return { pendingMerges: 2, reviewers: 2 };
}
