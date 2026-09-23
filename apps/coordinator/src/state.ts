/**
 * Coordinator state: the node registry, the rounds and the last sync time.
 * The model registry lives in its own document (see @eadwyn/model-registry).
 */

import type { JsonStore, StoreCodec } from "@eadwyn/service-kit";
import {
  IsoDateTimeSchema,
  NodeIdentitySchema,
  TrainingRoundSchema,
} from "@eadwyn/shared-protocol";
import {
  sampleNodeIdentities,
  samplePreviousTrainingRound,
  sampleTrainingRound,
} from "@eadwyn/shared-protocol/fixtures";
import { z } from "zod";

export const CoordinatorStateSchema = z.object({
  nodes: z.array(NodeIdentitySchema),
  rounds: z.array(TrainingRoundSchema),
  lastSyncAt: IsoDateTimeSchema.nullable(),
});
export type CoordinatorState = z.infer<typeof CoordinatorStateSchema>;

/**
 * `fixtures`: the local-development world (128 nodes, round 41 collecting).
 * `genesis`: a real deployment's first day — no nodes, the first round opens
 * on demand. Cloudflare deployments use `genesis`; nothing fake is recorded.
 */
export type SeedMode = "fixtures" | "genesis";

export function seedCoordinatorState(
  mode: SeedMode = "fixtures",
  now = new Date(),
): CoordinatorState {
  if (mode === "genesis") {
    return { nodes: [], rounds: [], lastSyncAt: null };
  }
  return {
    nodes: sampleNodeIdentities(now),
    rounds: [samplePreviousTrainingRound(now), sampleTrainingRound(now)],
    lastSyncAt: new Date(now.getTime() - 4 * 60_000).toISOString(),
  };
}

export function coordinatorCodec(
  mode: SeedMode = "fixtures",
  now?: () => Date,
): StoreCodec<CoordinatorState> {
  return {
    seed: () => seedCoordinatorState(mode, now?.()),
    parse: (raw) => CoordinatorStateSchema.parse(raw),
  };
}

export type CoordinatorStore = JsonStore<CoordinatorState>;
