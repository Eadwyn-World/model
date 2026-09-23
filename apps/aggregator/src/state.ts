/**
 * Aggregator state: every accepted update and every candidate it proposed.
 * Delta bytes are not stored here — only their content-addressed references.
 */
import { createJsonStore, type JsonStore } from "@eadwyn/service-kit";
import { MergeCandidateSchema, StoredUpdateSchema } from "@eadwyn/shared-protocol";
import { sampleGovernanceHistory, sampleStoredUpdates } from "@eadwyn/shared-protocol/fixtures";
import { z } from "zod";

export const AggregatorStateSchema = z.object({
  updates: z.array(StoredUpdateSchema),
  candidates: z.array(MergeCandidateSchema),
});
export type AggregatorState = z.infer<typeof AggregatorStateSchema>;

export function seedAggregatorState(now = new Date()): AggregatorState {
  return {
    updates: sampleStoredUpdates(now),
    candidates: sampleGovernanceHistory(now).candidates,
  };
}

export type AggregatorStore = JsonStore<AggregatorState>;

export function createAggregatorStore(filePath: string, now?: () => Date): AggregatorStore {
  return createJsonStore({
    filePath,
    seed: () => seedAggregatorState(now?.()),
    parse: (raw) => AggregatorStateSchema.parse(raw),
  });
}
