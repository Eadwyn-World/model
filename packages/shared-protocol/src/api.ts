/**
 * Request / response contracts for every HTTP surface.
 *
 * Services validate inbound bodies with these; the federation SDK validates
 * responses with the same schemas. A contract change breaks both sides at
 * type-check time, which is the point.
 */
import { z } from "zod";
import { GovernanceDecisionSchema } from "./governance";
import { AggregationMethodSchema, MergeCandidateSchema } from "./merge";
import { ModelVersionSchema } from "./model";
import { NodeIdentitySchema } from "./node";
import { ArtifactRefSchema, IsoDateTimeSchema, SemverSchema, UuidSchema } from "./primitives";
import { TrainingRoundSchema, TrainingUpdateSchema } from "./training";

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

export const HealthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  service: z.string(),
  version: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  time: IsoDateTimeSchema,
  details: z.record(z.string(), z.unknown()).optional(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

// ---------------------------------------------------------------------------
// Coordinator
// ---------------------------------------------------------------------------

export const RegisterNodeRequestSchema = NodeIdentitySchema.pick({
  displayName: true,
  role: true,
  podId: true,
  region: true,
  publicKey: true,
  capabilities: true,
});
export type RegisterNodeRequest = z.input<typeof RegisterNodeRequestSchema>;

export const RegisterNodeResponseSchema = z.object({
  node: NodeIdentitySchema,
  activeRound: TrainingRoundSchema,
});
export type RegisterNodeResponse = z.infer<typeof RegisterNodeResponseSchema>;

export const HeartbeatResponseSchema = RegisterNodeResponseSchema;
export type HeartbeatResponse = z.infer<typeof HeartbeatResponseSchema>;

export const NodeListResponseSchema = z.object({
  nodes: z.array(NodeIdentitySchema),
  total: z.number().int().nonnegative(),
});
export type NodeListResponse = z.infer<typeof NodeListResponseSchema>;

/** Sent by the aggregator when it accepts an update, so the coordinator can track round progress. */
export const RoundProgressRequestSchema = z.object({
  roundId: UuidSchema,
  nodeId: UuidSchema,
  updateId: UuidSchema,
});
export type RoundProgressRequest = z.input<typeof RoundProgressRequestSchema>;

export const RoundProgressResponseSchema = z.object({ round: TrainingRoundSchema });
export type RoundProgressResponse = z.infer<typeof RoundProgressResponseSchema>;

/** Sent by governance when a merge candidate is approved. */
export const PublishModelRequestSchema = z.object({
  candidateId: UuidSchema,
  roundId: UuidSchema,
  parentVersion: SemverSchema,
  checkpoint: ArtifactRefSchema,
  changelog: z.string().max(2000),
});
export type PublishModelRequest = z.input<typeof PublishModelRequestSchema>;

export const PublishModelResponseSchema = z.object({
  model: ModelVersionSchema,
  nextRound: TrainingRoundSchema,
});
export type PublishModelResponse = z.infer<typeof PublishModelResponseSchema>;

export const ModelVersionListResponseSchema = z.object({
  current: SemverSchema,
  versions: z.array(ModelVersionSchema),
});
export type ModelVersionListResponse = z.infer<typeof ModelVersionListResponseSchema>;

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

export const UpdateVerificationSchema = z.enum(["verified", "skipped"]);
export type UpdateVerification = z.infer<typeof UpdateVerificationSchema>;

export const SubmitUpdateResponseSchema = z.object({
  accepted: z.literal(true),
  updateId: UuidSchema,
  receivedAt: IsoDateTimeSchema,
  verification: UpdateVerificationSchema,
});
export type SubmitUpdateResponse = z.infer<typeof SubmitUpdateResponseSchema>;

export const StoredUpdateSchema = TrainingUpdateSchema.extend({
  receivedAt: IsoDateTimeSchema,
  verification: UpdateVerificationSchema,
});
export type StoredUpdate = z.infer<typeof StoredUpdateSchema>;

export const UpdateListResponseSchema = z.object({
  updates: z.array(StoredUpdateSchema),
  total: z.number().int().nonnegative(),
});
export type UpdateListResponse = z.infer<typeof UpdateListResponseSchema>;

export const CreateMergeRequestSchema = z.object({
  roundId: UuidSchema,
  method: AggregationMethodSchema.default("fedavg"),
});
export type CreateMergeRequest = z.input<typeof CreateMergeRequestSchema>;

export const MergeCandidateResponseSchema = z.object({
  candidate: MergeCandidateSchema,
  /** Whether the candidate reached governance. False means it is stored locally and must be resubmitted. */
  forwardedToGovernance: z.boolean(),
});
export type MergeCandidateResponse = z.infer<typeof MergeCandidateResponseSchema>;

export const MergeCandidateListResponseSchema = z.object({
  candidates: z.array(MergeCandidateSchema),
  total: z.number().int().nonnegative(),
});
export type MergeCandidateListResponse = z.infer<typeof MergeCandidateListResponseSchema>;

// ---------------------------------------------------------------------------
// Governance
// ---------------------------------------------------------------------------

export const MergeReviewSchema = z.object({
  candidate: MergeCandidateSchema,
  decisions: z.array(GovernanceDecisionSchema),
  tally: z.object({
    approvals: z.number().int().nonnegative(),
    rejections: z.number().int().nonnegative(),
    approvalQuorum: z.number().int().positive(),
    rejectionQuorum: z.number().int().positive(),
  }),
  /** Set once the coordinator has published the approved merge. */
  publishedVersion: SemverSchema.optional(),
  /** Set when an approved merge could not be published (e.g. stale base version). */
  publishError: z.string().optional(),
});
export type MergeReview = z.infer<typeof MergeReviewSchema>;

export const MergeReviewListResponseSchema = z.object({
  merges: z.array(MergeReviewSchema),
  total: z.number().int().nonnegative(),
});
export type MergeReviewListResponse = z.infer<typeof MergeReviewListResponseSchema>;

export const DecisionRequestSchema = GovernanceDecisionSchema.pick({
  reviewerId: true,
  verdict: true,
  rationale: true,
});
export type DecisionRequest = z.input<typeof DecisionRequestSchema>;

export const DecisionResponseSchema = z.object({
  decision: GovernanceDecisionSchema,
  review: MergeReviewSchema,
});
export type DecisionResponse = z.infer<typeof DecisionResponseSchema>;

export const DecisionListResponseSchema = z.object({
  decisions: z.array(GovernanceDecisionSchema),
  total: z.number().int().nonnegative(),
});
export type DecisionListResponse = z.infer<typeof DecisionListResponseSchema>;

export const ReviewerSummarySchema = z.object({
  reviewerId: z.string(),
  decisions: z.number().int().nonnegative(),
  approvals: z.number().int().nonnegative(),
  rejections: z.number().int().nonnegative(),
  lastDecisionAt: IsoDateTimeSchema,
});
export type ReviewerSummary = z.infer<typeof ReviewerSummarySchema>;

export const ReviewerListResponseSchema = z.object({
  reviewers: z.array(ReviewerSummarySchema),
  total: z.number().int().nonnegative(),
});
export type ReviewerListResponse = z.infer<typeof ReviewerListResponseSchema>;

// ---------------------------------------------------------------------------
// Inference edge
// ---------------------------------------------------------------------------

export const InferenceRequestSchema = z.object({
  prompt: z.string().min(1).max(4000),
  maxTokens: z.number().int().positive().max(512).default(128),
});
export type InferenceRequest = z.input<typeof InferenceRequestSchema>;

export const InferenceResponseSchema = z.object({
  modelVersion: SemverSchema,
  output: z.string(),
  usage: z.object({
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
  }),
  latencyMs: z.number().nonnegative(),
  /** Always true until a real runtime is wired in. Clients must not mistake mock output for the model. */
  mock: z.literal(true),
});
export type InferenceResponse = z.infer<typeof InferenceResponseSchema>;
