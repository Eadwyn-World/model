/**
 * MergeCandidate — what the aggregator proposes and governance reviews.
 *
 * Nothing becomes the global model without passing through this shape.
 */
import { z } from "zod";
import { ArtifactRefSchema, IsoDateTimeSchema, SemverSchema, UuidSchema } from "./primitives";

export const AggregationMethodSchema = z.enum(["fedavg", "trimmed-mean", "median"]);
export type AggregationMethod = z.infer<typeof AggregationMethodSchema>;

export const MergeStatusSchema = z.enum(["pending", "approved", "rejected", "published"]);
export type MergeStatus = z.infer<typeof MergeStatusSchema>;

export const AggregationSummarySchema = z.object({
  method: AggregationMethodSchema,
  participantCount: z.number().int().positive(),
  totalSamples: z.number().int().positive(),
  /** Sample-weighted mean of the participants' post-training loss. */
  weightedLossAfter: z.number().nonnegative(),
});
export type AggregationSummary = z.infer<typeof AggregationSummarySchema>;

export const MergeCandidateSchema = z.object({
  candidateId: UuidSchema,
  roundId: UuidSchema,
  baseModelVersion: SemverSchema,
  /** The aggregator's proposal. The coordinator assigns the final version on publish. */
  proposedVersion: SemverSchema,
  updateIds: z.array(UuidSchema).min(1),
  aggregation: AggregationSummarySchema,
  checkpoint: ArtifactRefSchema,
  status: MergeStatusSchema,
  /** Short, human-readable description reviewers see first. */
  summary: z.string().min(1).max(2000),
  createdAt: IsoDateTimeSchema,
});
export type MergeCandidate = z.infer<typeof MergeCandidateSchema>;
