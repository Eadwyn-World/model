/**
 * The aggregator's ports: what its routes and domain logic need from the
 * outside world. Node and Cloudflare each provide their own adapters.
 *
 *                      Node                      Cloudflare
 *   repository         JSON document             D1 tables (uniqueness constraints)
 *   objectStore        filesystem                R2 (+ presigned S3 uploads)
 *   reportProgress     direct HTTP, best effort  Queue → consumer → coordinator
 *   pipeline           in-process runner         Workflow (durable steps)
 *   aggregation        inline / HTTP             inline / Container / HTTP (Pod)
 */
import type { ObjectStore } from "@eadwyn/service-kit";
import type {
  AggregationJobRequest,
  AggregationJobResult,
  MergeCandidate,
  MergePipeline,
  StoredUpdate,
} from "@eadwyn/shared-protocol";

export interface AggregatorRepository {
  /** Throws HttpError 409 `duplicate_update` or `node_already_submitted` on a race. */
  insertUpdate(update: StoredUpdate): Promise<void>;
  getUpdate(updateId: string): Promise<StoredUpdate | undefined>;
  hasUpdate(updateId: string): Promise<boolean>;
  hasNodeSubmitted(roundId: string, nodeId: string): Promise<boolean>;
  listUpdates(roundId?: string): Promise<StoredUpdate[]>;
  insertCandidate(candidate: MergeCandidate, pipeline: MergePipeline): Promise<void>;
  getCandidate(
    candidateId: string,
  ): Promise<{ candidate: MergeCandidate; pipeline?: MergePipeline } | undefined>;
  /** Newest first. */
  listCandidates(): Promise<MergeCandidate[]>;
  saveCandidate(candidate: MergeCandidate): Promise<void>;
  savePipeline(candidateId: string, pipeline: MergePipeline): Promise<void>;
  counts(): Promise<{ updates: number; candidates: number }>;
}

/** Resolves a node's public key; `null` means the coordinator does not know the node. */
export type PublicKeyResolver = (nodeId: string) => Promise<string | null>;

export interface AggregationBackend {
  readonly name: string;
  aggregate(
    job: AggregationJobRequest,
    context: { inputBytes: number },
  ): Promise<AggregationJobResult>;
}

export interface MergePipelineRunner {
  /** Starts the durable follow-through for a new candidate. */
  start(candidateId: string): Promise<void>;
}

/** One step of a pipeline: named, retried by the runner, its result recorded. */
export interface StepRunner {
  do<T>(
    name: string,
    task: () => Promise<T>,
    options?: { retries?: number; timeoutSeconds?: number },
  ): Promise<T>;
}

export interface GovernanceSubmitter {
  submitCandidate(candidate: MergeCandidate): Promise<void>;
}

export interface AggregatorContext {
  repository: AggregatorRepository;
  objectStore?: ObjectStore;
  resolvePublicKey?: PublicKeyResolver;
  verifySignatures: boolean;
  maxDeltaBytes: number;
  now: () => Date;
}
