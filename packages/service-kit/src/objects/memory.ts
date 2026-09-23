import { type ObjectStoreBucket, sha256Hex } from "@eadwyn/shared-protocol";
import { ObjectIntegrityError, type ObjectStore, readAll } from "./types";

/** In-memory object store for tests. */
export function createMemoryObjectStore(): ObjectStore & { size(): number } {
  const objects = new Map<string, { bytes: Uint8Array; sha256: string }>();
  const id = (bucket: ObjectStoreBucket, key: string) => `${bucket}/${key}`;
  return {
    kind: "memory",
    size: () => objects.size,
    async head(bucket, key) {
      const found = objects.get(id(bucket, key));
      return found ? { bucket, key, bytes: found.bytes.byteLength, sha256: found.sha256 } : null;
    },
    async get(bucket, key) {
      return objects.get(id(bucket, key))?.bytes.slice() ?? null;
    },
    async put(bucket, key, body, expected) {
      const bytes = await readAll(body, expected.bytes + 1);
      const sha256 = await sha256Hex(bytes);
      if (bytes.byteLength !== expected.bytes || sha256 !== expected.sha256) {
        throw new ObjectIntegrityError(key, expected, { sha256, bytes: bytes.byteLength });
      }
      objects.set(id(bucket, key), { bytes, sha256 });
      return { bucket, key, bytes: bytes.byteLength, sha256 };
    },
  };
}
