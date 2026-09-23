/**
 * Training rounds and the updates nodes produce inside them.
 *
 * A TrainingUpdate is the only thing that ever leaves a node: a signed,
 * content-addressed delta plus the metrics needed to review it. Raw data
 * stays where it grows.
 */
import { z } from "zod";
import { ArtifactRefSchema, IsoDateTimeSchema, SemverSchema, UuidSchema } from "./primitives";

export const RoundStatusSchema = z.enum([
  "collecting", // nodes are training and submitting updates
  "aggregating", // the aggregator is folding updates into a merge candidate
  "reviewing", // governance is reviewing the candidate
  "published", // an approved merge became the new global version
  "closed", // round ended without a published merge
]);
export type RoundStatus = z.infer<typeof RoundStatusSchema>;

export const TrainingRoundSchema = z.object({
  roundId: UuidSchema,
  /** Monotonic, human-friendly round number. */
  number: z.number().int().positive(),
  /** Global model version every update in this round must start from. */
  baseModelVersion: SemverSchema,
  status: RoundStatusSchema,
  startedAt: IsoDateTimeSchema,
  closesAt: IsoDateTimeSchema.optional(),
  expectedNodes: z.number().int().nonnegative(),
  participatingNodeIds: z.array(UuidSchema),
  updatesReceived: z.number().int().nonnegative(),
});
export type TrainingRound = z.infer<typeof TrainingRoundSchema>;

export const TrainingMetricsSchema = z.object({
  /** Local examples the update was trained on. Never the examples themselves. */
  samples: z.number().int().positive(),
  steps: z.number().int().positive(),
  lossBefore: z.number().nonnegative(),
  lossAfter: z.number().nonnegative(),
  wallClockSeconds: z.number().nonnegative(),
});
export type TrainingMetrics = z.infer<typeof TrainingMetricsSchema>;

export const UnsignedTrainingUpdateSchema = z.object({
  updateId: UuidSchema,
  nodeId: UuidSchema,
  roundId: UuidSchema,
  baseModelVersion: SemverSchema,
  /** The weights delta (or adapter) — referenced, not embedded. */
  delta: ArtifactRefSchema,
  metrics: TrainingMetricsSchema,
  /** Knowledge-index items this update learned from, for provenance. */
  knowledgeItemIds: z.array(z.string().min(1)).default([]),
  createdAt: IsoDateTimeSchema,
});
export type UnsignedTrainingUpdate = z.infer<typeof UnsignedTrainingUpdateSchema>;

export const TrainingUpdateSchema = UnsignedTrainingUpdateSchema.extend({
  /** Ed25519 signature (base64) over the canonical JSON of the unsigned update. */
  signature: z.string().min(1),
});
export type TrainingUpdate = z.infer<typeof TrainingUpdateSchema>;
