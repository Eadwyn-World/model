/**
 * Ed25519 signing helpers for training updates.
 *
 * Node-only (uses node:crypto). Imported as `@eadwyn/shared-protocol/signing`
 * by the training runtime (to sign) and the aggregator (to verify). It is
 * deliberately not re-exported from the package root so browser bundles never
 * pull it in.
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { trainingUpdateSigningPayload } from "./canonical";
import type { TrainingUpdate, UnsignedTrainingUpdate } from "./training";

export interface NodeKeyPair {
  /** SPKI DER, base64. Safe to publish. */
  publicKey: string;
  /** PKCS#8 DER, base64. Never leaves the node. */
  privateKey: string;
}

export function generateNodeKeyPair(): NodeKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    privateKey: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
  };
}

export function signTrainingUpdate(update: UnsignedTrainingUpdate, privateKey: string): string {
  const key = createPrivateKey({
    key: Buffer.from(privateKey, "base64"),
    format: "der",
    type: "pkcs8",
  });
  return sign(null, Buffer.from(trainingUpdateSigningPayload(update), "utf8"), key).toString(
    "base64",
  );
}

export function verifyTrainingUpdateSignature(update: TrainingUpdate, publicKey: string): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKey, "base64"),
      format: "der",
      type: "spki",
    });
    const { signature, ...unsigned } = update;
    return verify(
      null,
      Buffer.from(trainingUpdateSigningPayload(unsigned), "utf8"),
      key,
      Buffer.from(signature, "base64"),
    );
  } catch {
    return false;
  }
}
