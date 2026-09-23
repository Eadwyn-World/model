/**
 * Object store over an S3-compatible API (R2's S3 endpoint), for code that
 * runs outside Workers and has no R2 binding: the merge runner in a
 * Cloudflare Container or on a Pod GPU.
 */
import { bytesToBase64, hexToBytes, type ObjectStoreBucket } from "@eadwyn/shared-protocol";
import { AwsClient } from "aws4fetch";
import { createS3Presigner, type S3PresignerOptions } from "./s3-presign";
import { ObjectIntegrityError, type ObjectStore, readAll } from "./types";

export type S3ObjectStoreOptions = S3PresignerOptions & { fetch?: typeof fetch };

export function createS3ObjectStore(options: S3ObjectStoreOptions): ObjectStore {
  const endpoint = options.endpoint.replace(/\/+$/, "");
  const client = new AwsClient({
    accessKeyId: options.accessKeyId,
    secretAccessKey: options.secretAccessKey,
    service: "s3",
    region: options.region ?? "auto",
  });
  const urlOf = (bucket: ObjectStoreBucket, key: string) =>
    `${endpoint}/${encodeURIComponent(options.bucketNames[bucket])}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const send = (url: string, init: RequestInit) =>
    options.fetch
      ? client.sign(url, init).then((req) => (options.fetch as typeof fetch)(req))
      : client.fetch(url, init);
  const presigner = createS3Presigner(options);

  return {
    kind: "r2",
    async head(bucket, key) {
      const res = await send(urlOf(bucket, key), {
        method: "HEAD",
        headers: { "x-amz-checksum-mode": "ENABLED" },
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HEAD ${key} failed with HTTP ${res.status}`);
      const checksum = res.headers.get("x-amz-checksum-sha256");
      const declared = res.headers.get("x-amz-meta-sha256");
      const sha256 = checksum
        ? Array.from(
            Uint8Array.from(atob(checksum), (c) => c.charCodeAt(0)),
            (b) => b.toString(16).padStart(2, "0"),
          ).join("")
        : (declared ?? undefined);
      return { bucket, key, bytes: Number(res.headers.get("content-length") ?? "0"), sha256 };
    },
    async get(bucket, key) {
      const res = await send(urlOf(bucket, key), { method: "GET" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`GET ${key} failed with HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    async put(bucket, key, body, expected) {
      const bytes = await readAll(body, expected.bytes + 1);
      if (bytes.byteLength !== expected.bytes) {
        throw new ObjectIntegrityError(key, expected, { bytes: bytes.byteLength });
      }
      const res = await send(urlOf(bucket, key), {
        method: "PUT",
        body: bytes.slice().buffer as ArrayBuffer,
        headers: {
          "x-amz-checksum-sha256": bytesToBase64(hexToBytes(expected.sha256)),
          "x-amz-meta-sha256": expected.sha256,
        },
      });
      if (res.status === 400 && (await res.clone().text()).includes("BadDigest")) {
        throw new ObjectIntegrityError(key, expected, { bytes: bytes.byteLength });
      }
      if (!res.ok)
        throw new Error(
          `PUT ${key} failed with HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`,
        );
      return { bucket, key, bytes: bytes.byteLength, sha256: expected.sha256 };
    },
    presignPut: (bucket, key, expected, ttl) => presigner.presignPut(bucket, key, expected, ttl),
  };
}
