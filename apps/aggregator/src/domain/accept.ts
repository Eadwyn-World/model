/**
 * Accepting a node's update: the shape was checked by zod; this checks what
 * a hostile or confused node could still get wrong, cheapest checks first.
 */
import { badRequest, conflict, forbidden, unauthorized, unavailable } from "@eadwyn/service-kit";
import {
  deltaObjectKey,
  type StoredUpdate,
  storeUri,
  type TrainingUpdate,
  type UpdateVerification,
} from "@eadwyn/shared-protocol";
import { verifyTrainingUpdateSignature } from "@eadwyn/shared-protocol/signing";
import type { AggregatorContext } from "../ports";

export async function acceptUpdate(
  ctx: AggregatorContext,
  update: TrainingUpdate,
): Promise<StoredUpdate> {
  const { repository, objectStore } = ctx;

  if (update.delta.bytes > ctx.maxDeltaBytes) {
    throw badRequest(
      "delta_too_large",
      `delta is ${update.delta.bytes} bytes; the limit is ${ctx.maxDeltaBytes}`,
    );
  }
  // With object storage, a delta must live at the one key derived from its
  // round and update id: nobody can point their update at someone else's bytes.
  const expectedUri = storeUri("deltas", deltaObjectKey(update.roundId, update.updateId));
  if (objectStore && update.delta.uri !== expectedUri) {
    throw badRequest(
      "delta_not_uploaded",
      `upload the delta to ${expectedUri} first (request an upload target)`,
    );
  }
  if (await repository.hasUpdate(update.updateId)) {
    throw conflict("duplicate_update", `update ${update.updateId} was already received`);
  }
  if (await repository.hasNodeSubmitted(update.roundId, update.nodeId)) {
    throw conflict(
      "node_already_submitted",
      `node ${update.nodeId} already contributed to round ${update.roundId}`,
    );
  }

  let verification: UpdateVerification = "skipped";
  if (ctx.verifySignatures) {
    if (!ctx.resolvePublicKey) {
      throw unavailable("node_registry_unavailable", "no public key resolver is configured");
    }
    let publicKey: string | null;
    try {
      publicKey = await ctx.resolvePublicKey(update.nodeId);
    } catch (error) {
      throw unavailable(
        "node_registry_unavailable",
        `could not reach the node registry: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (publicKey === null) {
      throw forbidden(
        "unknown_node",
        `node ${update.nodeId} is not registered with the coordinator`,
      );
    }
    if (!(await verifyTrainingUpdateSignature(update, publicKey))) {
      throw unauthorized("invalid_signature", "the update signature does not verify");
    }
    verification = "verified";
  }

  if (objectStore) {
    const stored = await objectStore.head(
      "deltas",
      deltaObjectKey(update.roundId, update.updateId),
    );
    if (!stored) {
      throw badRequest("delta_missing", `no delta has been uploaded to ${expectedUri}`);
    }
    // The stored object must be exactly what the node signed. When storage
    // could not compute a digest (some presigned uploads), the aggregation
    // job re-verifies the bytes before using them.
    if (
      stored.bytes !== update.delta.bytes ||
      (stored.sha256 && stored.sha256 !== update.delta.sha256)
    ) {
      throw badRequest("delta_mismatch", "the uploaded delta does not match the signed digest");
    }
  }

  const accepted: StoredUpdate = { ...update, receivedAt: ctx.now().toISOString(), verification };
  await repository.insertUpdate(accepted);
  return accepted;
}
