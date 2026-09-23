/**
 * Proposing a merge: fold a round's updates into a manifest (which deltas,
 * with which weights) and a pending candidate. The weight math happens later,
 * in the pipeline, wherever the aggregation backend runs.
 */
import { badRequest, conflict, type ObjectStore } from "@eadwyn/service-kit";
import {
  type AggregationMethod,
  bumpVersion,
  canonicalJson,
  type MergeCandidate,
  type MergeManifest,
  manifestObjectKey,
  parseStoreUri,
  type StoredUpdate,
  sha256Hex,
  storeUri,
  utf8Encode,
} from "@eadwyn/shared-protocol";

export interface ProposedMerge {
  candidate: MergeCandidate;
  manifest: MergeManifest;
  /** Total bytes of the deltas the backend must read. */
  inputBytes: number;
  /** Updates left out because their deltas are not in object storage. */
  skipped: number;
}

export async function proposeMerge(options: {
  roundId: string;
  method: AggregationMethod;
  updates: StoredUpdate[];
  objectStore?: ObjectStore;
  now: Date;
}): Promise<ProposedMerge> {
  const { roundId, method, now } = options;
  // Only updates whose bytes are in storage can be aggregated.
  const eligible = options.updates.filter((u) => parseStoreUri(u.delta.uri) !== null);
  const skipped = options.updates.length - eligible.length;
  if (eligible.length === 0) {
    throw badRequest(
      "no_updates",
      options.updates.length === 0
        ? `round ${roundId} has no accepted updates to merge`
        : `round ${roundId} has no updates with stored deltas to merge`,
    );
  }
  const bases = new Set(eligible.map((u) => u.baseModelVersion));
  if (bases.size > 1) {
    throw conflict(
      "mixed_base_versions",
      `updates in round ${roundId} start from different versions: ${[...bases].join(", ")}`,
    );
  }
  const baseModelVersion = eligible[0]?.baseModelVersion as string;
  const totalSamples = eligible.reduce((sum, u) => sum + u.metrics.samples, 0);
  const candidateId = crypto.randomUUID();

  const manifest: MergeManifest = {
    schema: "eadwyn.merge-manifest/1",
    candidateId,
    roundId,
    baseModelVersion,
    method,
    inputs: eligible.map((u) => ({
      updateId: u.updateId,
      nodeId: u.nodeId,
      delta: u.delta,
      samples: u.metrics.samples,
      weight: Math.round((u.metrics.samples / totalSamples) * 1e9) / 1e9,
    })),
    createdAt: now.toISOString(),
  };
  const manifestBytes = utf8Encode(canonicalJson(manifest));
  const manifestRef = {
    uri: storeUri("checkpoints", manifestObjectKey(roundId, candidateId)),
    sha256: await sha256Hex(manifestBytes),
    bytes: manifestBytes.byteLength,
  };
  if (options.objectStore) {
    await options.objectStore.put(
      "checkpoints",
      manifestObjectKey(roundId, candidateId),
      manifestBytes,
      {
        sha256: manifestRef.sha256,
        bytes: manifestRef.bytes,
      },
    );
  }

  const participants = new Set(eligible.map((u) => u.nodeId)).size;
  const lossBefore = weightedMean(eligible.map((u) => [u.metrics.lossBefore, u.metrics.samples]));
  const lossAfter = combine(method, eligible);
  const summary = [
    `${method} of ${eligible.length} updates (${totalSamples.toLocaleString("en-US")} samples) from ${participants} nodes.`,
    `Weighted loss ${lossAfter.toFixed(2)}, down from ${lossBefore.toFixed(2)}.`,
    skipped > 0 ? `${skipped} updates without stored deltas were left out.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const candidate: MergeCandidate = {
    candidateId,
    roundId,
    baseModelVersion,
    proposedVersion: bumpVersion(baseModelVersion, "minor"),
    updateIds: eligible.map((u) => u.updateId),
    aggregation: {
      method,
      participantCount: participants,
      totalSamples,
      weightedLossAfter: Math.round(lossAfter * 1000) / 1000,
    },
    // Until the pipeline has aggregated, the only artifact is the manifest.
    checkpoint: manifestRef,
    manifest: manifestRef,
    status: "pending",
    summary,
    createdAt: now.toISOString(),
  };
  return {
    candidate,
    manifest,
    inputBytes: eligible.reduce((sum, u) => sum + u.delta.bytes, 0),
    skipped,
  };
}

function combine(method: AggregationMethod, updates: StoredUpdate[]): number {
  const pairs = updates.map((u) => [u.metrics.lossAfter, u.metrics.samples] as [number, number]);
  if (method === "fedavg") return weightedMean(pairs);
  const sorted = pairs.map(([loss]) => loss).sort((a, b) => a - b);
  if (method === "median") {
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
      : (sorted[mid] as number);
  }
  const trim = Math.floor(sorted.length * 0.1);
  const kept = sorted.slice(trim, sorted.length - trim);
  return kept.reduce((s, v) => s + v, 0) / kept.length;
}

function weightedMean(pairs: [number, number][]): number {
  const weight = pairs.reduce((sum, [, w]) => sum + w, 0);
  if (weight === 0) return 0;
  return pairs.reduce((sum, [value, w]) => sum + value * w, 0) / weight;
}
