/**
 * Canonical JSON — a stable serialisation used for signing.
 *
 * Object keys are sorted recursively so that the same update always produces
 * the same bytes regardless of which runtime built it. No crypto lives here
 * so this module is safe to import in the browser.
 */
import type { UnsignedTrainingUpdate } from "./training";

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const entry = record[key];
      if (entry !== undefined) {
        sorted[key] = sortKeys(entry);
      }
    }
    return sorted;
  }
  return value;
}

/** The exact bytes a node signs and the aggregator verifies. */
export function trainingUpdateSigningPayload(update: UnsignedTrainingUpdate): string {
  const {
    updateId,
    nodeId,
    roundId,
    baseModelVersion,
    delta,
    metrics,
    knowledgeItemIds,
    createdAt,
  } = update;
  return canonicalJson({
    updateId,
    nodeId,
    roundId,
    baseModelVersion,
    delta,
    metrics,
    knowledgeItemIds,
    createdAt,
  });
}
