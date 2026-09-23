/**
 * R2 variant of the object store, over Worker bindings.
 *
 * Integrity: `put` passes the expected sha256 to R2, which refuses the write
 * if the bytes do not hash to it. Presigned uploads bypass the Worker, so
 * they are signed with `x-amz-checksum-sha256` and the aggregation step
 * verifies every delta's digest again before using it.
 */
import { bytesToHex, type ObjectStoreBucket } from "@eadwyn/shared-protocol";
import type { S3Presigner } from "./s3-presign";
import { ObjectIntegrityError, type ObjectStore, type StoredObject } from "./types";

export interface R2ObjectLike {
  key: string;
  size: number;
  checksums?: { sha256?: ArrayBuffer };
  customMetadata?: Record<string, string>;
}

export interface R2BucketLike {
  head(key: string): Promise<R2ObjectLike | null>;
  get(key: string): Promise<(R2ObjectLike & { arrayBuffer(): Promise<ArrayBuffer> }) | null>;
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView,
    options?: { sha256?: string; customMetadata?: Record<string, string> },
  ): Promise<R2ObjectLike | null>;
}

export interface R2ObjectStoreOptions {
  buckets: Record<ObjectStoreBucket, R2BucketLike>;
  /** Signs direct-to-R2 uploads through the S3 API. Optional: without it, uploads go through the Worker. */
  presigner?: S3Presigner;
}

function describe(bucket: ObjectStoreBucket, object: R2ObjectLike): StoredObject {
  const checksum = object.checksums?.sha256;
  return {
    bucket,
    key: object.key,
    bytes: object.size,
    sha256: checksum ? bytesToHex(new Uint8Array(checksum)) : undefined,
  };
}

export function createR2ObjectStore(options: R2ObjectStoreOptions): ObjectStore {
  const { buckets, presigner } = options;
  const store: ObjectStore = {
    kind: "r2",
    async head(bucket, key) {
      const object = await buckets[bucket].head(key);
      return object ? describe(bucket, object) : null;
    },
    async get(bucket, key) {
      const object = await buckets[bucket].get(key);
      return object ? new Uint8Array(await object.arrayBuffer()) : null;
    },
    async put(bucket, key, body, expected) {
      let written: R2ObjectLike | null;
      try {
        written = await buckets[bucket].put(key, body, {
          sha256: expected.sha256,
          customMetadata: { sha256: expected.sha256 },
        });
      } catch (error) {
        // R2 rejects a body whose digest differs from the one it was told to expect.
        throw new ObjectIntegrityError(key, expected, {
          bytes: -1,
          sha256: error instanceof Error ? error.message : String(error),
        });
      }
      if (!written) {
        throw new Error(`R2 did not store ${key}`);
      }
      const stored = describe(bucket, written);
      if (stored.bytes !== expected.bytes) {
        throw new ObjectIntegrityError(key, expected, {
          bytes: stored.bytes,
          sha256: stored.sha256,
        });
      }
      return { ...stored, sha256: stored.sha256 ?? expected.sha256 };
    },
  };
  if (presigner) {
    store.presignPut = (bucket, key, expected, expiresInSeconds) =>
      presigner.presignPut(bucket, key, expected, expiresInSeconds);
  }
  return store;
}
