/**
 * createFederationClient — one typed client for every Eadwyn service.
 *
 * Every response is validated with the shared-protocol schemas, so a service
 * drifting from the contract fails here, loudly, instead of deep in UI code.
 */
import {
  type CreateMergeRequest,
  DecisionListResponseSchema,
  type DecisionRequest,
  DecisionResponseSchema,
  FederationStatsSchema,
  HealthResponseSchema,
  HeartbeatResponseSchema,
  type InferenceRequest,
  InferenceResponseSchema,
  MergeCandidateListResponseSchema,
  MergeCandidateResponseSchema,
  MergeCandidateSchema,
  MergeReviewListResponseSchema,
  MergeReviewSchema,
  type MergeStatus,
  ModelVersionListResponseSchema,
  ModelVersionSchema,
  NodeIdentitySchema,
  NodeListResponseSchema,
  type PublishModelRequest,
  PublishModelResponseSchema,
  type RegisterNodeRequest,
  RegisterNodeResponseSchema,
  ReviewerListResponseSchema,
  type RoundProgressRequest,
  RoundProgressResponseSchema,
  StoredUpdateSchema,
  SubmitUpdateResponseSchema,
  TrainingRoundSchema,
  type TrainingUpdate,
  UpdateListResponseSchema,
} from "@eadwyn/shared-protocol";
import { z } from "zod";
import { type HttpOptions, request } from "./http";

export interface FederationClientOptions {
  coordinatorUrl?: string;
  aggregatorUrl?: string;
  governanceUrl?: string;
  inferenceEdgeUrl?: string;
  /** Injectable for tests and for runtimes with a patched fetch (e.g. Next.js). */
  fetch?: typeof fetch;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

/** Local development defaults; every service reads the same ports from its env. */
export const DEFAULT_FEDERATION_URLS = {
  coordinatorUrl: "http://localhost:4101",
  aggregatorUrl: "http://localhost:4102",
  governanceUrl: "http://localhost:4103",
  inferenceEdgeUrl: "http://localhost:4104",
} as const;

const CandidateEnvelope = z.object({ candidate: MergeCandidateSchema });
const StoredUpdateEnvelope = z.object({ update: StoredUpdateSchema });

export function createFederationClient(options: FederationClientOptions = {}) {
  const http: HttpOptions = {
    fetch: options.fetch ?? ((...args) => globalThis.fetch(...args)),
    timeoutMs: options.timeoutMs ?? 5_000,
    headers: options.headers ?? {},
  };
  const { coordinatorUrl, aggregatorUrl, governanceUrl, inferenceEdgeUrl } = options;

  return {
    coordinator: {
      health: () => request(coordinatorUrl, "health", { schema: HealthResponseSchema }, http),
      getStats: () => request(coordinatorUrl, "v1/stats", { schema: FederationStatsSchema }, http),
      getCurrentModel: () =>
        request(coordinatorUrl, "v1/model/current", { schema: ModelVersionSchema }, http),
      listModelVersions: () =>
        request(
          coordinatorUrl,
          "v1/model/versions",
          { schema: ModelVersionListResponseSchema },
          http,
        ),
      getActiveRound: () =>
        request(coordinatorUrl, "v1/rounds/active", { schema: TrainingRoundSchema }, http),
      listNodes: () =>
        request(coordinatorUrl, "v1/nodes", { schema: NodeListResponseSchema }, http),
      getNode: (nodeId: string) =>
        request(
          coordinatorUrl,
          `v1/nodes/${encodeURIComponent(nodeId)}`,
          { schema: NodeIdentitySchema },
          http,
        ),
      registerNode: (body: RegisterNodeRequest) =>
        request(
          coordinatorUrl,
          "v1/nodes/register",
          { method: "POST", body, schema: RegisterNodeResponseSchema },
          http,
        ),
      heartbeat: (nodeId: string) =>
        request(
          coordinatorUrl,
          `v1/nodes/${encodeURIComponent(nodeId)}/heartbeat`,
          { method: "POST", body: {}, schema: HeartbeatResponseSchema },
          http,
        ),
      reportRoundProgress: (body: RoundProgressRequest) =>
        request(
          coordinatorUrl,
          "v1/rounds/active/progress",
          { method: "POST", body, schema: RoundProgressResponseSchema },
          http,
        ),
      publishModel: (body: PublishModelRequest) =>
        request(
          coordinatorUrl,
          "v1/model/publish",
          { method: "POST", body, schema: PublishModelResponseSchema },
          http,
        ),
    },

    aggregator: {
      health: () => request(aggregatorUrl, "health", { schema: HealthResponseSchema }, http),
      submitUpdate: (update: TrainingUpdate) =>
        request(
          aggregatorUrl,
          "v1/updates",
          { method: "POST", body: update, schema: SubmitUpdateResponseSchema },
          http,
        ),
      listUpdates: (roundId?: string) =>
        request(
          aggregatorUrl,
          "v1/updates",
          { query: { roundId }, schema: UpdateListResponseSchema },
          http,
        ),
      getUpdate: async (updateId: string) =>
        (
          await request(
            aggregatorUrl,
            `v1/updates/${encodeURIComponent(updateId)}`,
            { schema: StoredUpdateEnvelope },
            http,
          )
        ).update,
      createMergeCandidate: (body: CreateMergeRequest) =>
        request(
          aggregatorUrl,
          "v1/merges",
          { method: "POST", body, schema: MergeCandidateResponseSchema },
          http,
        ),
      listMergeCandidates: () =>
        request(aggregatorUrl, "v1/merges", { schema: MergeCandidateListResponseSchema }, http),
    },

    governance: {
      health: () => request(governanceUrl, "health", { schema: HealthResponseSchema }, http),
      listMerges: (status?: MergeStatus | "all") =>
        request(
          governanceUrl,
          "v1/merges",
          { query: { status }, schema: MergeReviewListResponseSchema },
          http,
        ),
      getMerge: (candidateId: string) =>
        request(
          governanceUrl,
          `v1/merges/${encodeURIComponent(candidateId)}`,
          { schema: MergeReviewSchema },
          http,
        ),
      submitCandidate: async (candidate: z.input<typeof MergeCandidateSchema>) =>
        (
          await request(
            governanceUrl,
            "v1/merges",
            { method: "POST", body: candidate, schema: CandidateEnvelope },
            http,
          )
        ).candidate,
      decide: (candidateId: string, body: DecisionRequest) =>
        request(
          governanceUrl,
          `v1/merges/${encodeURIComponent(candidateId)}/decisions`,
          { method: "POST", body, schema: DecisionResponseSchema },
          http,
        ),
      listDecisions: (reviewerId?: string) =>
        request(
          governanceUrl,
          "v1/decisions",
          { query: { reviewerId }, schema: DecisionListResponseSchema },
          http,
        ),
      listReviewers: () =>
        request(governanceUrl, "v1/reviewers", { schema: ReviewerListResponseSchema }, http),
    },

    inferenceEdge: {
      health: () => request(inferenceEdgeUrl, "health", { schema: HealthResponseSchema }, http),
      getModel: () => request(inferenceEdgeUrl, "v1/model", { schema: ModelVersionSchema }, http),
      infer: (body: InferenceRequest) =>
        request(
          inferenceEdgeUrl,
          "v1/infer",
          { method: "POST", body, schema: InferenceResponseSchema },
          http,
        ),
    },
  };
}

export type FederationClient = ReturnType<typeof createFederationClient>;
