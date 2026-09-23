/**
 * Node-side aggregator state: one JSON document with every accepted update,
 * every candidate it proposed, and each candidate's pipeline status.
 */
import type { StoreCodec } from "@eadwyn/service-kit";
import {
  MergeCandidateSchema,
  MergePipelineSchema,
  StoredUpdateSchema,
} from "@eadwyn/shared-protocol";
import { sampleGovernanceHistory, sampleStoredUpdates } from "@eadwyn/shared-protocol/fixtures";
import { z } from "zod";

export const AggregatorStateSchema = z.object({
  updates: z.array(StoredUpdateSchema),
  candidates: z.array(MergeCandidateSchema),
  pipelines: z.record(z.string(), MergePipelineSchema).default({}),
});
export type AggregatorState = z.infer<typeof AggregatorStateSchema>;

export type SeedMode = "fixtures" | "genesis";

export function seedAggregatorState(
  mode: SeedMode = "fixtures",
  now = new Date(),
): AggregatorState {
  if (mode === "genesis") return { updates: [], candidates: [], pipelines: {} };
  return {
    updates: sampleStoredUpdates(now),
    candidates: sampleGovernanceHistory(now).candidates,
    pipelines: {},
  };
}

export function aggregatorCodec(
  mode: SeedMode = "fixtures",
  now?: () => Date,
): StoreCodec<AggregatorState> {
  return {
    seed: () => seedAggregatorState(mode, now?.()),
    parse: (raw) => AggregatorStateSchema.parse(raw),
  };
}
