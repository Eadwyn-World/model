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
import {
  ArtifactRefSchema,
  IsoDateTimeSchema,
  SemverSchema,
  Sha256Schema,
  UuidSchema,
} from "./primitives";
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

/** A node asks where to put its delta before it signs and submits the update. */
export const DeltaUploadRequestSchema = z.object({
  updateId: UuidSchema,
  roundId: UuidSchema,
  nodeId: UuidSchema,
  sha256: Sha256Schema,
  bytes: z.number().int().positive(),
});
export type DeltaUploadRequest = z.input<typeof DeltaUploadRequestSchema>;

export const DeltaUploadModeSchema = z.enum([
  "direct", // PUT the bytes to the aggregator, which streams them into its object store
  "presigned", // PUT the bytes straight to object storage with a short-lived signed URL
  "unavailable", // no object store here; keep the delta on the node and reference it locally
]);
export type DeltaUploadMode = z.infer<typeof DeltaUploadModeSchema>;

export const DeltaUploadTargetSchema = z.object({
  mode: DeltaUploadModeSchema,
  /** The `delta.uri` the update must carry once the bytes are in place. */
  uri: z.string().min(1),
  method: z.literal("PUT").optional(),
  url: z.url().optional(),
  headers: z.record(z.string(), z.string()).default({}),
  expiresAt: IsoDateTimeSchema.optional(),
  maxBytes: z.number().int().positive(),
});
export type DeltaUploadTarget = z.infer<typeof DeltaUploadTargetSchema>;

export const DeltaUploadReceiptSchema = z.object({
  uri: z.string().min(1),
  sha256: Sha256Schema,
  bytes: z.number().int().nonnegative(),
  storedAt: IsoDateTimeSchema,
});
export type DeltaUploadReceipt = z.infer<typeof DeltaUploadReceiptSchema>;

export const CreateMergeRequestSchema = z.object({
  roundId: UuidSchema,
  method: AggregationMethodSchema.default("fedavg"),
});
export type CreateMergeRequest = z.input<typeof CreateMergeRequestSchema>;

/** Durable follow-through after a candidate is proposed (a Cloudflare Workflow in production). */
export const MergePipelineStatusSchema = z.enum(["queued", "running", "forwarded", "failed"]);
export type MergePipelineStatus = z.infer<typeof MergePipelineStatusSchema>;

export const MergePipelineSchema = z.object({
  id: z.string().min(1),
  status: MergePipelineStatusSchema,
  steps: z
    .array(
      z.object({
        name: z.string().min(1),
        status: z.enum(["ok", "failed"]),
        at: IsoDateTimeSchema,
        detail: z.string().optional(),
      }),
    )
    .default([]),
  error: z.string().optional(),
  updatedAt: IsoDateTimeSchema,
});
export type MergePipeline = z.infer<typeof MergePipelineSchema>;

export const MergeCandidateResponseSchema = z.object({
  candidate: MergeCandidateSchema,
  /** Whether governance already has the candidate. False with a pipeline means it is on its way. */
  forwardedToGovernance: z.boolean(),
  pipeline: MergePipelineSchema.optional(),
});
export type MergeCandidateResponse = z.infer<typeof MergeCandidateResponseSchema>;

export const MergeCandidateDetailSchema = z.object({
  candidate: MergeCandidateSchema,
  pipeline: MergePipelineSchema.optional(),
});
export type MergeCandidateDetail = z.infer<typeof MergeCandidateDetailSchema>;

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
  /** Whether governance will keep retrying the publish on its own. */
  publishRetrying: z.boolean().optional(),
});
export type MergeReview = z.infer<typeof MergeReviewSchema>;

export const MergeReviewListResponseSchema = z.object({
  merges: z.array(MergeReviewSchema),
  total: z.number().int().nonnegative(),
});
export type MergeReviewListResponse = z.infer<typeof MergeReviewListResponseSchema>;

/**
 * `reviewerId` is taken from the verified Cloudflare Access identity when the
 * governance service runs behind Access, and from the body otherwise.
 */
export const DecisionRequestSchema = GovernanceDecisionSchema.pick({
  reviewerId: true,
  verdict: true,
  rationale: true,
}).partial({ reviewerId: true });
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

export const InferenceBackendSchema = z.enum(["mock", "workers-ai", "upstream"]);
export type InferenceBackend = z.infer<typeof InferenceBackendSchema>;

export const InferenceResponseSchema = z.object({
  modelVersion: SemverSchema,
  output: z.string(),
  usage: z.object({
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
  }),
  latencyMs: z.number().nonnegative(),
  backend: InferenceBackendSchema,
  /** Runtime model that produced the text, e.g. a Workers AI model id. Absent for mock answers. */
  model: z.string().optional(),
  /** Fine-tune adapter applied on top of `model`, if any. */
  adapter: z.string().optional(),
  /** True whenever the answer did not come from a real model. Clients must not mistake mock output for the model. */
  mock: z.boolean(),
  cached: z.boolean().default(false),
});
export type InferenceResponse = z.infer<typeof InferenceResponseSchema>;

/** The edge pulls the coordinator's current version into its served registry. */
export const EdgeSyncResponseSchema = z.object({
  servedVersion: SemverSchema,
  coordinatorVersion: SemverSchema.optional(),
  adopted: z.boolean(),
  error: z.string().optional(),
});
export type EdgeSyncResponse = z.infer<typeof EdgeSyncResponseSchema>;
