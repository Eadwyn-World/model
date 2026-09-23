/**
 * Node entrypoint (local development and self-hosting).
 * The Cloudflare entrypoint is src/worker/index.ts; both run the same routes.
 */
import { join } from "node:path";
import { createFederationClient, FederationApiError } from "@eadwyn/federation-sdk";
import { createLogger } from "@eadwyn/service-kit";
import {
  createFileObjectStore,
  createFileStore,
  loadEnv,
  startService,
} from "@eadwyn/service-kit/node";
import { createAggregatorApp } from "./app";
import { createAutoBackend, createInlineBackend, createRemoteBackend } from "./backends";
import { runMergePipeline } from "./domain/pipeline";
import { EnvSchema } from "./env";
import { createInProcessPipeline } from "./node/pipeline-runner";
import type { AggregationBackend } from "./ports";
import { createDocumentRepository } from "./repository/document";
import { aggregatorCodec } from "./state";

const env = loadEnv(EnvSchema);
const logger = createLogger({
  service: "aggregator",
  format: env.LOG_FORMAT,
  level: env.LOG_LEVEL,
});
const internalHeaders: Record<string, string> = env.INTERNAL_API_TOKEN
  ? { authorization: `Bearer ${env.INTERNAL_API_TOKEN}` }
  : {};
const federation = createFederationClient({
  coordinatorUrl: env.COORDINATOR_URL,
  governanceUrl: env.GOVERNANCE_URL,
  timeoutMs: 3_000,
  headers: internalHeaders,
});

const repository = createDocumentRepository(
  createFileStore({
    filePath: join(env.DATA_DIR, "aggregator.json"),
    ...aggregatorCodec(env.SEED_MODE),
  }),
);
const objectStore = createFileObjectStore(join(env.DATA_DIR, "objects"));

const inline = createInlineBackend(objectStore);
const http = env.MERGE_RUNNER_URL
  ? createRemoteBackend({
      name: "http",
      fetch: (r) => fetch(r),
      baseUrl: env.MERGE_RUNNER_URL,
      token: env.MERGE_RUNNER_TOKEN,
    })
  : undefined;
const backend: AggregationBackend =
  env.AGGREGATION_BACKEND === "http" && http
    ? http
    : env.AGGREGATION_BACKEND === "inline"
      ? inline
      : createAutoBackend({
          inline,
          offload: http,
          inlineMaxBytes: env.INLINE_AGGREGATION_MAX_BYTES,
        });

const pipelineDeps = {
  repository,
  backend,
  governance: {
    submitCandidate: async (c: Parameters<typeof federation.governance.submitCandidate>[0]) =>
      void (await federation.governance.submitCandidate(c)),
  },
  now: () => new Date(),
};

// Public keys change only when a node re-registers, so a small cache is safe.
const publicKeys = new Map<string, string>();

const app = createAggregatorApp({
  repository,
  objectStore,
  logger,
  verifySignatures: env.AGGREGATOR_VERIFY_SIGNATURES,
  maxDeltaBytes: env.AGGREGATOR_MAX_DELTA_BYTES,
  now: () => new Date(),
  uploads: {
    maxDeltaBytes: env.AGGREGATOR_MAX_DELTA_BYTES,
    tokenSecret: env.UPLOAD_TOKEN_SECRET ?? crypto.randomUUID() + crypto.randomUUID(),
    ttlSeconds: env.UPLOAD_TTL_SECONDS,
  },
  resolvePublicKey: async (nodeId) => {
    const cached = publicKeys.get(nodeId);
    if (cached) return cached;
    try {
      const node = await federation.coordinator.getNode(nodeId);
      publicKeys.set(nodeId, node.publicKey);
      return node.publicKey;
    } catch (error) {
      if (error instanceof FederationApiError && error.status === 404) return null;
      throw error;
    }
  },
  reportProgress: (update) =>
    federation.coordinator.reportRoundProgress({
      roundId: update.roundId,
      nodeId: update.nodeId,
      updateId: update.updateId,
    }),
  pipeline: createInProcessPipeline({
    run: (id, step) => runMergePipeline(pipelineDeps, id, step),
    logger,
  }),
  operatorToken: env.OPERATOR_TOKEN,
});

startService(app, {
  port: env.PORT,
  host: env.HOST,
  logger,
  internalToken: env.INTERNAL_API_TOKEN,
});
