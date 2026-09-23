/**
 * Object storage for the artifacts that travel: weight deltas and merged
 * checkpoints. Bytes never pass through the JSON stores; they live here,
 * addressed as `store://<bucket>/<key>` in the protocol.
 */
import type { ObjectStoreBucket } from "@eadwyn/shared-protocol";

export interface StoredObject {
  bucket: ObjectStoreBucket;
  key: string;
  bytes: number;
  /** Lowercase hex sha256, when the store computed or verified it. */
  sha256?: string;
}

export interface ObjectExpectation {
  sha256: string;
  bytes: number;
}

export interface PresignedPut {
  url: string;
  /** Headers the uploader must send verbatim; they are part of the signature. */
  headers: Record<string, string>;
  expiresAt: string;
}

export interface ObjectStore {
  readonly kind: "filesystem" | "r2" | "memory";
  head(bucket: ObjectStoreBucket, key: string): Promise<StoredObject | null>;
  get(bucket: ObjectStoreBucket, key: string): Promise<Uint8Array | null>;
  /** Stores the body and verifies it against `expected`; throws ObjectIntegrityError on mismatch. */
  put(
    bucket: ObjectStoreBucket,
    key: string,
    body: Uint8Array | ReadableStream<Uint8Array>,
    expected: ObjectExpectation,
  ): Promise<StoredObject>;
  /** Present when uploaders can write straight to storage with a short-lived signed URL. */
  presignPut?(
    bucket: ObjectStoreBucket,
    key: string,
    expected: ObjectExpectation,
    expiresInSeconds: number,
  ): Promise<PresignedPut>;
}

export class ObjectIntegrityError extends Error {
  readonly expected: ObjectExpectation;
  readonly actual: { sha256?: string; bytes: number };
  constructor(
    key: string,
    expected: ObjectExpectation,
    actual: { sha256?: string; bytes: number },
  ) {
    super(
      `object ${key} does not match its declared digest: expected ${expected.bytes} bytes / ${expected.sha256}, got ${actual.bytes} bytes${actual.sha256 ? ` / ${actual.sha256}` : ""}`,
    );
    this.name = "ObjectIntegrityError";
    this.expected = expected;
    this.actual = actual;
  }
}

export async function readAll(
  body: Uint8Array | ReadableStream<Uint8Array>,
  limit: number,
): Promise<Uint8Array> {
  if (body instanceof Uint8Array) {
    return body;
  }
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new ObjectIntegrityError("(stream)", { sha256: "", bytes: limit }, { bytes: total });
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}
