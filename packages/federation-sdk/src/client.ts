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
  type DeltaUploadRequest,
  type DeltaUploadTarget,
  DeltaUploadTargetSchema,
  EdgeSyncResponseSchema,
  FederationStatsSchema,
  HealthResponseSchema,
  HeartbeatResponseSchema,
  type InferenceRequest,
  InferenceResponseSchema,
  MergeCandidateDetailSchema,
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
import { FederationApiError, type HttpOptions, request } from "./http";

export type FederationService = "coordinator" | "aggregator" | "governance" | "inferenceEdge";

export interface FederationClientOptions {
  coordinatorUrl?: string;
  aggregatorUrl?: string;
  governanceUrl?: string;
  inferenceEdgeUrl?: string;
  /** Injectable for tests and for runtimes with a patched fetch (e.g. Next.js). */
  fetch?: typeof fetch;
  /**
   * Per-service transports. On Cloudflare, pass a service binding's fetch
   * (`env.COORDINATOR.fetch.bind(env.COORDINATOR)`) so calls never leave
   * Cloudflare's network; the service URL then only needs to be well-formed.
   */
  transports?: Partial<Record<FederationService, typeof fetch>>;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

/** Placeholder origin for calls that travel over a service binding. */
export const BINDING_ORIGIN = {
  coordinator: "https://coordinator.eadwyn.internal",
  aggregator: "https://aggregator.eadwyn.internal",
  governance: "https://governance.eadwyn.internal",
  inferenceEdge: "https://inference-edge.eadwyn.internal",
} as const satisfies Record<FederationService, string>;

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
  const baseFetch: typeof fetch = options.fetch ?? ((...args) => globalThis.fetch(...args));
  const httpFor = (service: FederationService): HttpOptions => ({
    fetch: options.transports?.[service] ?? baseFetch,
    timeoutMs: options.timeoutMs ?? 5_000,
    headers: options.headers ?? {},
  });
  const coordinatorHttp = httpFor("coordinator");
  const aggregatorHttp = httpFor("aggregator");
  const governanceHttp = httpFor("governance");
  const edgeHttp = httpFor("inferenceEdge");
  const coordinatorUrl =
    options.coordinatorUrl ??
    (options.transports?.coordinator ? BINDING_ORIGIN.coordinator : undefined);
  const aggregatorUrl =
    options.aggregatorUrl ??
    (options.transports?.aggregator ? BINDING_ORIGIN.aggregator : undefined);
  const governanceUrl =
    options.governanceUrl ??
    (options.transports?.governance ? BINDING_ORIGIN.governance : undefined);
  const inferenceEdgeUrl =
    options.inferenceEdgeUrl ??
    (options.transports?.inferenceEdge ? BINDING_ORIGIN.inferenceEdge : undefined);

  return {
    coordinator: {
      health: () =>
        request(coordinatorUrl, "health", { schema: HealthResponseSchema }, coordinatorHttp),
      getStats: () =>
        request(coordinatorUrl, "v1/stats", { schema: FederationStatsSchema }, coordinatorHttp),
      getCurrentModel: () =>
        request(
          coordinatorUrl,
          "v1/model/current",
          { schema: ModelVersionSchema },
          coordinatorHttp,
        ),
      listModelVersions: () =>
        request(
          coordinatorUrl,
          "v1/model/versions",
          { schema: ModelVersionListResponseSchema },
          coordinatorHttp,
        ),
      getActiveRound: () =>
        request(
          coordinatorUrl,
          "v1/rounds/active",
          { schema: TrainingRoundSchema },
          coordinatorHttp,
        ),
      listNodes: () =>
        request(coordinatorUrl, "v1/nodes", { schema: NodeListResponseSchema }, coordinatorHttp),
      getNode: (nodeId: string) =>
        request(
          coordinatorUrl,
          `v1/nodes/${encodeURIComponent(nodeId)}`,
          { schema: NodeIdentitySchema },
          coordinatorHttp,
        ),
      registerNode: (body: RegisterNodeRequest) =>
        request(
          coordinatorUrl,
          "v1/nodes/register",
          { method: "POST", body, schema: RegisterNodeResponseSchema },
          coordinatorHttp,
        ),
      heartbeat: (nodeId: string) =>
        request(
          coordinatorUrl,
          `v1/nodes/${encodeURIComponent(nodeId)}/heartbeat`,
          { method: "POST", body: {}, schema: HeartbeatResponseSchema },
          coordinatorHttp,
        ),
      reportRoundProgress: (body: RoundProgressRequest) =>
        request(
          coordinatorUrl,
          "v1/rounds/active/progress",
          { method: "POST", body, schema: RoundProgressResponseSchema },
          coordinatorHttp,
        ),
      publishModel: (body: PublishModelRequest) =>
        request(
          coordinatorUrl,
          "v1/model/publish",
          { method: "POST", body, schema: PublishModelResponseSchema },
          coordinatorHttp,
        ),
    },

    aggregator: {
      health: () =>
        request(aggregatorUrl, "health", { schema: HealthResponseSchema }, aggregatorHttp),
      submitUpdate: (update: TrainingUpdate) =>
        request(
          aggregatorUrl,
          "v1/updates",
          { method: "POST", body: update, schema: SubmitUpdateResponseSchema },
          aggregatorHttp,
        ),
      listUpdates: (roundId?: string) =>
        request(
          aggregatorUrl,
          "v1/updates",
          { query: { roundId }, schema: UpdateListResponseSchema },
          aggregatorHttp,
        ),
      getUpdate: async (updateId: string) =>
        (
          await request(
            aggregatorUrl,
            `v1/updates/${encodeURIComponent(updateId)}`,
            { schema: StoredUpdateEnvelope },
            aggregatorHttp,
          )
        ).update,
      createMergeCandidate: (body: CreateMergeRequest) =>
        request(
          aggregatorUrl,
          "v1/merges",
          { method: "POST", body, schema: MergeCandidateResponseSchema },
          aggregatorHttp,
        ),
      listMergeCandidates: () =>
        request(
          aggregatorUrl,
          "v1/merges",
          { schema: MergeCandidateListResponseSchema },
          aggregatorHttp,
        ),
      getMergeCandidate: (candidateId: string) =>
        request(
          aggregatorUrl,
          `v1/merges/${encodeURIComponent(candidateId)}`,
          { schema: MergeCandidateDetailSchema },
          aggregatorHttp,
        ),
      /** Ask where to put a delta before signing the update that references it. */
      requestUploadTarget: (body: DeltaUploadRequest) =>
        request(
          aggregatorUrl,
          "v1/updates/upload-target",
          { method: "POST", body, schema: DeltaUploadTargetSchema },
          aggregatorHttp,
        ),
      /** PUT the delta bytes where the upload target says (the aggregator, or straight to R2). */
      uploadDelta: async (target: DeltaUploadTarget, bytes: Uint8Array): Promise<void> => {
        if (target.mode === "unavailable") return;
        if (!target.url) {
          throw new FederationApiError({
            status: 0,
            code: "invalid_target",
            message: "upload target has no URL",
            url: "",
          });
        }
        const put = target.mode === "direct" ? aggregatorHttp.fetch : baseFetch;
        const body = bytes.slice().buffer as ArrayBuffer;
        const response = await put(target.url, { method: "PUT", headers: target.headers, body });
        if (!response.ok) {
          throw new FederationApiError({
            status: response.status,
            code: "upload_failed",
            message: `delta upload failed with HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`,
            url: target.url,
          });
        }
      },
    },

    governance: {
      health: () =>
        request(governanceUrl, "health", { schema: HealthResponseSchema }, governanceHttp),
      listMerges: (status?: MergeStatus | "all") =>
        request(
          governanceUrl,
          "v1/merges",
          { query: { status }, schema: MergeReviewListResponseSchema },
          governanceHttp,
        ),
      getMerge: (candidateId: string) =>
        request(
          governanceUrl,
          `v1/merges/${encodeURIComponent(candidateId)}`,
          { schema: MergeReviewSchema },
          governanceHttp,
        ),
      submitCandidate: async (candidate: z.input<typeof MergeCandidateSchema>) =>
        (
          await request(
            governanceUrl,
            "v1/merges",
            { method: "POST", body: candidate, schema: CandidateEnvelope },
            governanceHttp,
          )
        ).candidate,
      decide: (candidateId: string, body: DecisionRequest) =>
        request(
          governanceUrl,
          `v1/merges/${encodeURIComponent(candidateId)}/decisions`,
          { method: "POST", body, schema: DecisionResponseSchema },
          governanceHttp,
        ),
      listDecisions: (reviewerId?: string) =>
        request(
          governanceUrl,
          "v1/decisions",
          { query: { reviewerId }, schema: DecisionListResponseSchema },
          governanceHttp,
        ),
      listReviewers: () =>
        request(
          governanceUrl,
          "v1/reviewers",
          { schema: ReviewerListResponseSchema },
          governanceHttp,
        ),
    },

    inferenceEdge: {
      health: () => request(inferenceEdgeUrl, "health", { schema: HealthResponseSchema }, edgeHttp),
      getModel: () =>
        request(inferenceEdgeUrl, "v1/model", { schema: ModelVersionSchema }, edgeHttp),
      infer: (body: InferenceRequest) =>
        request(
          inferenceEdgeUrl,
          "v1/infer",
          { method: "POST", body, schema: InferenceResponseSchema },
          edgeHttp,
        ),
      /** Pull the coordinator's current version into the edge (operator or internal callers). */
      sync: () =>
        request(
          inferenceEdgeUrl,
          "v1/sync",
          { method: "POST", body: {}, schema: EdgeSyncResponseSchema },
          edgeHttp,
        ),
    },
  };
}

export type FederationClient = ReturnType<typeof createFederationClient>;
