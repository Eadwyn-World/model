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
  /** The merged weights reviewers are asked to accept (or, before aggregation runs, the manifest). */
  checkpoint: ArtifactRefSchema,
  /** Exactly which updates were folded in, with which weights. */
  manifest: ArtifactRefSchema.optional(),
  status: MergeStatusSchema,
  /** Short, human-readable description reviewers see first. */
  summary: z.string().min(1).max(2000),
  createdAt: IsoDateTimeSchema,
});
export type MergeCandidate = z.infer<typeof MergeCandidateSchema>;

/**
 * MergeManifest — the recipe for one merge, written before any weight math
 * runs. Whoever aggregates (a Worker, a Container, a Pod GPU) reads this and
 * nothing else, so the same manifest always produces the same checkpoint.
 */
export const MergeManifestInputSchema = z.object({
  updateId: UuidSchema,
  nodeId: UuidSchema,
  delta: ArtifactRefSchema,
  samples: z.number().int().positive(),
  /** Normalised aggregation weight; the weights of a manifest sum to 1. */
  weight: z.number().nonnegative(),
});
export type MergeManifestInput = z.infer<typeof MergeManifestInputSchema>;

export const MergeManifestSchema = z.object({
  schema: z.literal("eadwyn.merge-manifest/1"),
  candidateId: UuidSchema,
  roundId: UuidSchema,
  baseModelVersion: SemverSchema,
  method: AggregationMethodSchema,
  inputs: z.array(MergeManifestInputSchema).min(1),
  createdAt: IsoDateTimeSchema,
});
export type MergeManifest = z.infer<typeof MergeManifestSchema>;

/** A request to the aggregation backend: fold the manifest's deltas into one artifact. */
export const AggregationJobRequestSchema = z.object({
  jobId: z.string().min(1),
  manifest: ArtifactRefSchema,
  /** Where to write the merged delta, as a `store://checkpoints/...` URI. */
  outputUri: z.string().min(1),
});
export type AggregationJobRequest = z.infer<typeof AggregationJobRequestSchema>;

export const AggregationJobResultSchema = z.object({
  jobId: z.string().min(1),
  artifact: ArtifactRefSchema,
  method: AggregationMethodSchema,
  inputs: z.number().int().positive(),
  tensors: z.number().int().nonnegative(),
  /** Where the math ran: `inline` (Worker/Node), `container`, `http` (a Pod), or `none` (metadata only). */
  backend: z.string().min(1),
  durationMs: z.number().nonnegative(),
});
export type AggregationJobResult = z.infer<typeof AggregationJobResultSchema>;
