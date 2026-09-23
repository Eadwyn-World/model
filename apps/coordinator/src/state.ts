/**
 * Coordinator state: the node registry, the rounds and the last sync time.
 * The model registry lives in its own file (see @eadwyn/model-registry).
 */
import { createJsonStore, type JsonStore } from "@eadwyn/service-kit";
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

export function seedCoordinatorState(now = new Date()): CoordinatorState {
  return {
    nodes: sampleNodeIdentities(now),
    rounds: [samplePreviousTrainingRound(now), sampleTrainingRound(now)],
    lastSyncAt: new Date(now.getTime() - 4 * 60_000).toISOString(),
  };
}

export type CoordinatorStore = JsonStore<CoordinatorState>;

export function createCoordinatorStore(filePath: string, now?: () => Date): CoordinatorStore {
  return createJsonStore({
    filePath,
    seed: () => seedCoordinatorState(now?.()),
    parse: (raw) => CoordinatorStateSchema.parse(raw),
  });
}
