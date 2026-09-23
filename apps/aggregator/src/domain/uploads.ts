/**
 * Where deltas go before their update is submitted.
 *
 *  - presigned: the node PUTs straight to R2 with a short-lived SigV4 URL
 *    bound to one key and to the delta's sha256. Bytes never touch a Worker.
 *  - direct: the node PUTs to the aggregator, which streams into storage and
 *    verifies the digest. Used on Node, in local Workers development, and on
 *    Cloudflare when no R2 S3 credentials are configured (deltas ≤ 100 MB).
 *  - unavailable: no object store; the delta stays on the node (milestone 1).
 *
 * Direct URLs carry an HMAC token over (key, sha256, bytes, expiry), so an
 * upload target cannot be reused for different bytes or after it expires.
 */
import {
  badRequest,
  forbidden,
  HttpError,
  type ObjectStore,
  unauthorized,
} from "@eadwyn/service-kit";
import {
  bytesToBase64,
  type DeltaUploadRequest,
  type DeltaUploadTarget,
  deltaObjectKey,
  storeUri,
  toArrayBuffer,
  utf8Encode,
} from "@eadwyn/shared-protocol";
import type { PublicKeyResolver } from "../ports";

export interface UploadSettings {
  maxDeltaBytes: number;
  /** HMAC secret for direct upload URLs. */
  tokenSecret?: string;
  ttlSeconds: number;
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(utf8Encode(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, toArrayBuffer(utf8Encode(message)));
  return bytesToBase64(new Uint8Array(mac))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const tokenMessage = (key: string, sha256: string, bytes: number, expires: number) =>
  `eadwyn-upload/1\n${key}\n${sha256}\n${bytes}\n${expires}`;

export async function issueUploadTarget(options: {
  request: DeltaUploadRequest;
  origin: string;
  objectStore?: ObjectStore;
  resolvePublicKey?: PublicKeyResolver;
  settings: UploadSettings;
  now: Date;
}): Promise<DeltaUploadTarget> {
  const { request, origin, objectStore, resolvePublicKey, settings, now } = options;
  if (request.bytes > settings.maxDeltaBytes) {
    throw badRequest(
      "delta_too_large",
      `delta is ${request.bytes} bytes; the limit is ${settings.maxDeltaBytes}`,
    );
  }
  if (resolvePublicKey && (await resolvePublicKey(request.nodeId)) === null) {
    throw forbidden(
      "unknown_node",
      `node ${request.nodeId} is not registered with the coordinator`,
    );
  }
  const key = deltaObjectKey(request.roundId, request.updateId);
  if (!objectStore) {
    return {
      mode: "unavailable",
      uri: `local://${request.nodeId}/rounds/${request.roundId}/${request.updateId}.safetensors`,
      headers: {},
      maxBytes: settings.maxDeltaBytes,
    };
  }
  const uri = storeUri("deltas", key);
  const expected = { sha256: request.sha256, bytes: request.bytes };
  if (objectStore.presignPut) {
    const signed = await objectStore.presignPut("deltas", key, expected, settings.ttlSeconds);
    return {
      mode: "presigned",
      uri,
      method: "PUT",
      url: signed.url,
      headers: signed.headers,
      expiresAt: signed.expiresAt,
      maxBytes: settings.maxDeltaBytes,
    };
  }
  if (!settings.tokenSecret) {
    throw new HttpError(503, "upload_misconfigured", "UPLOAD_TOKEN_SECRET is not configured");
  }
  const expires = Math.floor(now.getTime() / 1000) + settings.ttlSeconds;
  const token = await hmac(
    settings.tokenSecret,
    tokenMessage(key, request.sha256, request.bytes, expires),
  );
  const url = new URL(`/v1/deltas/${request.roundId}/${request.updateId}`, origin);
  url.searchParams.set("sha256", request.sha256);
  url.searchParams.set("bytes", String(request.bytes));
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("token", token);
  return {
    mode: "direct",
    uri,
    method: "PUT",
    url: url.toString(),
    headers: { "content-type": "application/octet-stream" },
    expiresAt: new Date(expires * 1000).toISOString(),
    maxBytes: settings.maxDeltaBytes,
  };
}

/** Checks a direct upload URL's token; returns what the body must hash to. */
export async function verifyUploadToken(options: {
  roundId: string;
  updateId: string;
  query: Record<string, string | undefined>;
  settings: UploadSettings;
  now: Date;
}): Promise<{ key: string; sha256: string; bytes: number }> {
  const { roundId, updateId, query, settings, now } = options;
  const sha256 = query.sha256 ?? "";
  const bytes = Number(query.bytes);
  const expires = Number(query.expires);
  if (
    !settings.tokenSecret ||
    !query.token ||
    !/^[a-f0-9]{64}$/.test(sha256) ||
    !Number.isInteger(bytes) ||
    !Number.isInteger(expires)
  ) {
    throw unauthorized("upload_token_invalid", "upload URL is malformed");
  }
  if (expires < Math.floor(now.getTime() / 1000)) {
    throw unauthorized(
      "upload_token_expired",
      "upload URL has expired; request a new upload target",
    );
  }
  const key = deltaObjectKey(roundId, updateId);
  const expected = await hmac(settings.tokenSecret, tokenMessage(key, sha256, bytes, expires));
  if (expected !== query.token) {
    throw unauthorized("upload_token_invalid", "upload URL signature does not match");
  }
  return { key, sha256, bytes };
}
