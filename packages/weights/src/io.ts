/**
 * AggregationIO over any object store addressed by `store://<bucket>/<key>`.
 * Structural types keep this package free of storage dependencies.
 */
import { type ArtifactRef, type ObjectStoreBucket, parseStoreUri } from "@eadwyn/shared-protocol";
import { AggregationInputError, type AggregationIO } from "./job";

export interface ObjectStoreLike {
  get(bucket: ObjectStoreBucket, key: string): Promise<Uint8Array | null>;
  put(
    bucket: ObjectStoreBucket,
    key: string,
    body: Uint8Array,
    expected: { sha256: string; bytes: number },
  ): Promise<{ bytes: number; sha256?: string }>;
}

export function objectStoreIO(store: ObjectStoreLike): AggregationIO {
  const locate = (uri: string) => {
    const location = parseStoreUri(uri);
    if (!location) {
      throw new AggregationInputError(
        `${uri} is not in object storage (expected store://<bucket>/<key>)`,
      );
    }
    return location;
  };
  return {
    async read(uri) {
      const { bucket, key } = locate(uri);
      return store.get(bucket, key);
    },
    async write(uri, bytes, sha256): Promise<ArtifactRef> {
      const { bucket, key } = locate(uri);
      const stored = await store.put(bucket, key, bytes, { sha256, bytes: bytes.byteLength });
      return { uri, sha256: stored.sha256 ?? sha256, bytes: stored.bytes };
    },
  };
}
