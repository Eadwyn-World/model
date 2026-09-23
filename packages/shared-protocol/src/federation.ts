/**
 * FederationStats — the public readout of the federation.
 *
 * This is what the AI Model page renders. It is the coordinator's view;
 * governance adds its own counts (pending merges) through its own API.
 */
import { z } from "zod";
import { IsoDateTimeSchema, SemverSchema } from "./primitives";
import { TrainingRoundSchema } from "./training";

export const FederationStatsSchema = z.object({
  globalModelVersion: SemverSchema,
  globalModelPublishedAt: IsoDateTimeSchema,
  activeRound: TrainingRoundSchema,
  registeredNodes: z.number().int().nonnegative(),
  /** Nodes seen within the coordinator's online window. */
  onlineNodes: z.number().int().nonnegative(),
  /** Last time learning arrived from any node. Null until the first update. */
  lastSyncAt: IsoDateTimeSchema.nullable(),
  generatedAt: IsoDateTimeSchema,
});
export type FederationStats = z.infer<typeof FederationStatsSchema>;
