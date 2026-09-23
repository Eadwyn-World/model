/**
 * Semantic validation of an update, after the zod shape check.
 *
 * Shape is necessary but not sufficient: the update must be new, the node
 * must not have already contributed to this round, the delta must fit, and
 * the signature must verify against the node's registered public key.
 */
import { badRequest, conflict, forbidden, unauthorized, unavailable } from "@eadwyn/service-kit";
import type { StoredUpdate, TrainingUpdate, UpdateVerification } from "@eadwyn/shared-protocol";
import { verifyTrainingUpdateSignature } from "@eadwyn/shared-protocol/signing";
import type { AggregatorState } from "../state";

/** Resolves a node's public key; `null` means the coordinator does not know the node. */
export type PublicKeyResolver = (nodeId: string) => Promise<string | null>;

export interface ValidateUpdateOptions {
  maxDeltaBytes: number;
  verifySignatures: boolean;
  resolvePublicKey?: PublicKeyResolver;
}

export async function validateUpdate(
  state: AggregatorState,
  update: TrainingUpdate,
  options: ValidateUpdateOptions,
): Promise<UpdateVerification> {
  if (update.delta.bytes > options.maxDeltaBytes) {
    throw badRequest(
      "delta_too_large",
      `delta is ${update.delta.bytes} bytes; the limit is ${options.maxDeltaBytes}`,
    );
  }
  if (state.updates.some((u) => u.updateId === update.updateId)) {
    throw conflict("duplicate_update", `update ${update.updateId} was already received`);
  }
  if (state.updates.some((u) => u.roundId === update.roundId && u.nodeId === update.nodeId)) {
    throw conflict(
      "node_already_submitted",
      `node ${update.nodeId} already contributed to round ${update.roundId}`,
    );
  }
  if (!options.verifySignatures) {
    return "skipped";
  }
  if (!options.resolvePublicKey) {
    throw unavailable("node_registry_unavailable", "no public key resolver is configured");
  }
  let publicKey: string | null;
  try {
    publicKey = await options.resolvePublicKey(update.nodeId);
  } catch (error) {
    throw unavailable(
      "node_registry_unavailable",
      `could not reach the node registry: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (publicKey === null) {
    throw forbidden("unknown_node", `node ${update.nodeId} is not registered with the coordinator`);
  }
  if (!verifyTrainingUpdateSignature(update, publicKey)) {
    throw unauthorized("invalid_signature", "the update signature does not verify");
  }
  return "verified";
}

export function storeUpdate(
  state: AggregatorState,
  update: TrainingUpdate,
  verification: UpdateVerification,
  receivedAt: Date,
): StoredUpdate {
  const stored: StoredUpdate = { ...update, receivedAt: receivedAt.toISOString(), verification };
  state.updates.push(stored);
  return stored;
}
