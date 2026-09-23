/**
 * Mock aggregation: folds a round's updates into a MergeCandidate.
 *
 * No weights are touched. The checkpoint reference is derived from the set of
 * update digests, so the same inputs always produce the same candidate hash,
 * and the metrics are combined the way the named method would combine them.
 * Real FedAvg / robust aggregation plugs in behind this function.
 */
import { createHash, randomUUID } from "node:crypto";
import { badRequest, conflict } from "@eadwyn/service-kit";
import {
  type AggregationMethod,
  bumpVersion,
  type MergeCandidate,
  type StoredUpdate,
} from "@eadwyn/shared-protocol";
import { MOCK_CHECKPOINT_BYTES } from "@eadwyn/shared-protocol/fixtures";

export function buildMergeCandidate(input: {
  roundId: string;
  method: AggregationMethod;
  updates: StoredUpdate[];
  now: Date;
}): MergeCandidate {
  const { roundId, method, updates, now } = input;
  if (updates.length === 0) {
    throw badRequest("no_updates", `round ${roundId} has no accepted updates to merge`);
  }
  const baseVersions = new Set(updates.map((u) => u.baseModelVersion));
  if (baseVersions.size > 1) {
    throw conflict(
      "mixed_base_versions",
      `updates in round ${roundId} start from different versions: ${[...baseVersions].join(", ")}`,
    );
  }
  const baseModelVersion = updates[0]?.baseModelVersion as string;
  const totalSamples = updates.reduce((sum, u) => sum + u.metrics.samples, 0);
  const participantCount = new Set(updates.map((u) => u.nodeId)).size;
  const lossBefore = weightedMean(updates.map((u) => [u.metrics.lossBefore, u.metrics.samples]));
  const lossAfter = combine(method, updates);

  const candidateId = randomUUID();
  const digest = createHash("sha256");
  digest.update(method);
  for (const sha of updates.map((u) => u.delta.sha256).sort()) {
    digest.update(sha);
  }

  return {
    candidateId,
    roundId,
    baseModelVersion,
    proposedVersion: bumpVersion(baseModelVersion, "minor"),
    updateIds: updates.map((u) => u.updateId),
    aggregation: {
      method,
      participantCount,
      totalSamples,
      weightedLossAfter: round3(lossAfter),
    },
    checkpoint: {
      uri: `eadwyn://candidates/${roundId}/${candidateId}.safetensors`,
      sha256: digest.digest("hex"),
      bytes: MOCK_CHECKPOINT_BYTES,
    },
    status: "pending",
    summary: `${method} of ${updates.length} updates (${totalSamples.toLocaleString("en-US")} samples) from ${participantCount} nodes. Weighted loss ${round3(lossAfter).toFixed(2)}, down from ${round3(lossBefore).toFixed(2)}.`,
    createdAt: now.toISOString(),
  };
}

function combine(method: AggregationMethod, updates: StoredUpdate[]): number {
  const pairs = updates.map((u) => [u.metrics.lossAfter, u.metrics.samples] as [number, number]);
  switch (method) {
    case "fedavg":
      return weightedMean(pairs);
    case "median": {
      const sorted = pairs.map(([loss]) => loss).sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0
        ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
        : (sorted[mid] as number);
    }
    case "trimmed-mean": {
      const sorted = pairs.slice().sort((a, b) => a[0] - b[0]);
      const trim = Math.floor(sorted.length * 0.1);
      const kept = sorted.slice(trim, sorted.length - trim);
      return weightedMean(kept.length > 0 ? kept : sorted);
    }
  }
}

function weightedMean(pairs: [number, number][]): number {
  const weight = pairs.reduce((sum, [, w]) => sum + w, 0);
  if (weight === 0) return 0;
  return pairs.reduce((sum, [value, w]) => sum + value * w, 0) / weight;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
