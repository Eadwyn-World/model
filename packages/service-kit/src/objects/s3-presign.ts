/**
 * Presigned PUT URLs for R2's S3-compatible endpoint (SigV4 query signing).
 *
 * The URL is bound to one object key, expires quickly, and carries the
 * expected sha256 as a signed `x-amz-checksum-sha256` header, so the
 * uploader cannot swap the bytes without invalidating the signature.
 */
import { bytesToBase64, hexToBytes, type ObjectStoreBucket } from "@eadwyn/shared-protocol";
import { AwsV4Signer } from "aws4fetch";
import type { ObjectExpectation, PresignedPut } from "./types";

export interface S3PresignerOptions {
  /** e.g. https://<account-id>.r2.cloudflarestorage.com */
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Real bucket names behind the logical buckets. */
  bucketNames: Record<ObjectStoreBucket, string>;
  region?: string;
  now?: () => Date;
}

export interface S3Presigner {
  presignPut(
    bucket: ObjectStoreBucket,
    key: string,
    expected: ObjectExpectation,
    expiresInSeconds: number,
  ): Promise<PresignedPut>;
}

export function createS3Presigner(options: S3PresignerOptions): S3Presigner {
  const endpoint = options.endpoint.replace(/\/+$/, "");
  const now = options.now ?? (() => new Date());
  return {
    async presignPut(bucket, key, expected, expiresInSeconds) {
      const url = new URL(
        `${endpoint}/${encodeURIComponent(options.bucketNames[bucket])}/${key
          .split("/")
          .map(encodeURIComponent)
          .join("/")}`,
      );
      url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));
      const headers = {
        "x-amz-checksum-sha256": bytesToBase64(hexToBytes(expected.sha256)),
        "x-amz-meta-sha256": expected.sha256,
      };
      const signedAt = now();
      const signer = new AwsV4Signer({
        method: "PUT",
        url: url.toString(),
        headers,
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
        service: "s3",
        region: options.region ?? "auto",
        signQuery: true,
        datetime: signedAt.toISOString().replace(/[:-]|\.\d{3}/g, ""),
      });
      const signed = await signer.sign();
      return {
        url: signed.url.toString(),
        headers,
        expiresAt: new Date(signedAt.getTime() + expiresInSeconds * 1000).toISOString(),
      };
    },
  };
}
