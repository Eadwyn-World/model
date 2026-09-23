/**
 * Ed25519 signing helpers for training updates, on WebCrypto.
 *
 * Works on Node 22+, Cloudflare Workers and modern browsers. Imported as
 * `@eadwyn/shared-protocol/signing` by the training runtime (to sign) and the
 * aggregator (to verify).
 */
import { trainingUpdateSigningPayload } from "./canonical";
import { base64ToBytes, bytesToBase64, toArrayBuffer, utf8Encode } from "./encoding";
import type { TrainingUpdate, UnsignedTrainingUpdate } from "./training";

const ED25519 = { name: "Ed25519" } as const;

export interface NodeKeyPair {
  /** SPKI DER, base64. Safe to publish. */
  publicKey: string;
  /** PKCS#8 DER, base64. Never leaves the node. */
  privateKey: string;
}

export async function generateNodeKeyPair(): Promise<NodeKeyPair> {
  const pair = (await crypto.subtle.generateKey(ED25519, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const [spki, pkcs8] = await Promise.all([
    crypto.subtle.exportKey("spki", pair.publicKey),
    crypto.subtle.exportKey("pkcs8", pair.privateKey),
  ]);
  return {
    // exportKey is typed as ArrayBuffer | JsonWebKey; "spki" and "pkcs8" always yield bytes.
    publicKey: bytesToBase64(new Uint8Array(spki as ArrayBuffer)),
    privateKey: bytesToBase64(new Uint8Array(pkcs8 as ArrayBuffer)),
  };
}

export async function signTrainingUpdate(
  update: UnsignedTrainingUpdate,
  privateKey: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    toArrayBuffer(base64ToBytes(privateKey)),
    ED25519,
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    ED25519,
    key,
    toArrayBuffer(utf8Encode(trainingUpdateSigningPayload(update))),
  );
  return bytesToBase64(new Uint8Array(signature));
}

export async function verifyTrainingUpdateSignature(
  update: TrainingUpdate,
  publicKey: string,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "spki",
      toArrayBuffer(base64ToBytes(publicKey)),
      ED25519,
      false,
      ["verify"],
    );
    const { signature, ...unsigned } = update;
    return await crypto.subtle.verify(
      ED25519,
      key,
      toArrayBuffer(base64ToBytes(signature)),
      toArrayBuffer(utf8Encode(trainingUpdateSigningPayload(unsigned))),
    );
  } catch {
    return false;
  }
}
