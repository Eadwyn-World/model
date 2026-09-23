/**
 * Object-store addressing for the artifacts that travel: weight deltas and
 * candidate checkpoints. `store://<bucket>/<key>` is runtime-agnostic; the
 * aggregator maps buckets to R2 on Cloudflare and to a directory on Node.
 */
export const OBJECT_STORE_SCHEME = "store://";

export type ObjectStoreBucket = "deltas" | "checkpoints";

export function deltaObjectKey(roundId: string, updateId: string): string {
  return `rounds/${roundId}/updates/${updateId}.safetensors`;
}

/** The merge recipe, written before any weight math runs. */
export function manifestObjectKey(roundId: string, candidateId: string): string {
  return `rounds/${roundId}/candidates/${candidateId}/manifest.json`;
}

/** The merged adapter delta produced by the aggregation backend. */
export function mergedDeltaObjectKey(roundId: string, candidateId: string): string {
  return `rounds/${roundId}/candidates/${candidateId}/merged.safetensors`;
}

export function storeUri(bucket: ObjectStoreBucket, key: string): string {
  return `${OBJECT_STORE_SCHEME}${bucket}/${key}`;
}

export function parseStoreUri(uri: string): { bucket: ObjectStoreBucket; key: string } | null {
  if (!uri.startsWith(OBJECT_STORE_SCHEME)) {
    return null;
  }
  const rest = uri.slice(OBJECT_STORE_SCHEME.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) {
    return null;
  }
  const bucket = rest.slice(0, slash);
  const key = rest.slice(slash + 1);
  if ((bucket !== "deltas" && bucket !== "checkpoints") || key.length === 0) {
    return null;
  }
  return { bucket, key };
}
