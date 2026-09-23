/**
 * Cloudflare entrypoint for the aggregator.
 *
 *  fetch (public)      nodes: upload targets, direct uploads, signed updates;
 *                      operators: start a merge (OPERATOR_TOKEN)
 *  InternalApi         the same routes for other services (service bindings)
 *  queue               "update.accepted" events → coordinator round progress,
 *                      retried with backoff until the coordinator has them
 *  MergePipeline       Workflow: aggregate → record checkpoint → forward to
 *                      governance; each step persisted and retried alone
 *  MergeRunnerContainer  a Cloudflare Container running apps/merge-runner,
 *                      for merges too large to aggregate inside a Worker
 *
 * Deltas live in R2. With R2 S3 credentials configured, nodes upload straight
 * to R2 with presigned URLs; otherwise through the Worker (≤ 100 MB).
 */

import {
  WorkerEntrypoint,
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { Container, getContainer } from "@cloudflare/containers";
import { createFederationClient, FederationApiError } from "@eadwyn/federation-sdk";
import {
  type Caller,
  createLogger,
  createR2ObjectStore,
  createS3Presigner,
  type ObjectStore,
  parseEnv,
  withCaller,
} from "@eadwyn/service-kit";
import type { Hono } from "hono";
import { createAggregatorApp } from "../app";
import { createAutoBackend, createInlineBackend, createRemoteBackend } from "../backends";
import { type PipelineDeps, runMergePipeline } from "../domain/pipeline";
import { EnvSchema } from "../env";
import type { AggregationBackend, StepRunner } from "../ports";
import { createD1Repository } from "./repository";

interface UpdateAcceptedEvent {
  type: "update.accepted";
  roundId: string;
  nodeId: string;
  updateId: string;
}

function settings(env: Env) {
  const config = parseEnv(EnvSchema, env as unknown as Record<string, unknown>);
  const logger = createLogger({ service: "aggregator", format: "json", level: config.LOG_LEVEL });
  return { config, logger };
}

function coordinator(env: Env) {
  return createFederationClient({
    transports: { coordinator: env.COORDINATOR_INTERNAL.fetch.bind(env.COORDINATOR_INTERNAL) },
    timeoutMs: 10_000,
  });
}

function objectStoreFor(env: Env): ObjectStore {
  const { config } = settings(env);
  const presigner =
    config.R2_ACCOUNT_ID && config.R2_ACCESS_KEY_ID && config.R2_SECRET_ACCESS_KEY
      ? createS3Presigner({
          endpoint: `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
          accessKeyId: config.R2_ACCESS_KEY_ID,
          secretAccessKey: config.R2_SECRET_ACCESS_KEY,
          bucketNames: {
            deltas: config.R2_DELTAS_BUCKET,
            checkpoints: config.R2_CHECKPOINTS_BUCKET,
          },
        })
      : undefined;
  return createR2ObjectStore({
    buckets: { deltas: env.DELTAS, checkpoints: env.CHECKPOINTS },
    presigner,
  });
}

function backendFor(env: Env): AggregationBackend {
  const { config } = settings(env);
  const inline = createInlineBackend(objectStoreFor(env));
  const container = createRemoteBackend({
    name: "container",
    fetch: (request) => getContainer(env.MERGE_RUNNER, "merge-runner").fetch(request),
    baseUrl: "http://merge-runner.container",
    token: config.MERGE_RUNNER_TOKEN,
  });
  const http = config.MERGE_RUNNER_URL
    ? createRemoteBackend({
        name: "http",
        fetch: (r) => fetch(r),
        baseUrl: config.MERGE_RUNNER_URL,
        token: config.MERGE_RUNNER_TOKEN,
      })
    : undefined;
  switch (config.AGGREGATION_BACKEND) {
    case "inline":
      return inline;
    case "container":
      return container;
    case "http":
      if (!http) throw new Error("AGGREGATION_BACKEND=http needs MERGE_RUNNER_URL");
      return http;
    default:
      // Small adapters are merged in the Workflow step itself; anything larger
      // goes to a Pod (MERGE_RUNNER_URL) or, failing that, the Container.
      return createAutoBackend({
        inline,
        offload: http ?? container,
        inlineMaxBytes: config.INLINE_AGGREGATION_MAX_BYTES,
      });
  }
}

function pipelineDeps(env: Env): PipelineDeps {
  const governance = createFederationClient({
    transports: { governance: env.GOVERNANCE_INTERNAL.fetch.bind(env.GOVERNANCE_INTERNAL) },
    timeoutMs: 10_000,
  });
  return {
    repository: createD1Repository(env.DB),
    backend: backendFor(env),
    governance: {
      submitCandidate: async (candidate) => {
        try {
          await governance.governance.submitCandidate(candidate);
        } catch (error) {
          if (error instanceof FederationApiError) {
            throw Object.assign(new Error(error.message), {
              code: error.code,
              retryable: error.status >= 500 || error.status === 0,
            });
          }
          throw error;
        }
      },
    },
    now: () => new Date(),
  };
}

// Public keys change only when a node re-registers; cache them per isolate.
const publicKeys = new Map<string, string>();

const apps = new WeakMap<object, Hono>();

function appFor(env: Env): Hono {
  let app = apps.get(env);
  if (app) return app;
  const { config, logger } = settings(env);
  const client = coordinator(env);
  app = createAggregatorApp({
    repository: createD1Repository(env.DB),
    objectStore: objectStoreFor(env),
    logger,
    verifySignatures: config.AGGREGATOR_VERIFY_SIGNATURES,
    maxDeltaBytes: config.AGGREGATOR_MAX_DELTA_BYTES,
    now: () => new Date(),
    uploads: {
      maxDeltaBytes: config.AGGREGATOR_MAX_DELTA_BYTES,
      tokenSecret: config.UPLOAD_TOKEN_SECRET,
      ttlSeconds: config.UPLOAD_TTL_SECONDS,
    },
    resolvePublicKey: async (nodeId) => {
      const cached = publicKeys.get(nodeId);
      if (cached) return cached;
      try {
        const node = await client.coordinator.getNode(nodeId);
        publicKeys.set(nodeId, node.publicKey);
        return node.publicKey;
      } catch (error) {
        if (error instanceof FederationApiError && error.status === 404) return null;
        throw error;
      }
    },
    // Durable hand-off: the queue consumer below delivers it to the coordinator.
    reportProgress: (update) =>
      env.FEDERATION_EVENTS.send({
        type: "update.accepted",
        roundId: update.roundId,
        nodeId: update.nodeId,
        updateId: update.updateId,
      } satisfies UpdateAcceptedEvent),
    pipeline: {
      start: async (candidateId) => {
        await env.MERGE_PIPELINE.create({ id: candidateId, params: { candidateId } });
      },
    },
    operatorToken: config.OPERATOR_TOKEN,
  });
  apps.set(env, app);
  return app;
}

function handle(env: Env, request: Request, caller: Caller): Promise<Response> {
  return Promise.resolve(appFor(env).fetch(withCaller(request, caller)));
}

/** Runs the shared pipeline as a Workflow: every step's result is persisted. */
export class MergePipeline extends WorkflowEntrypoint<Env, { candidateId: string }> {
  override async run(
    event: WorkflowEvent<{ candidateId: string }>,
    step: WorkflowStep,
  ): Promise<{ candidateId: string; checkpoint: string }> {
    const runner: StepRunner = {
      do: <T>(
        name: string,
        task: () => Promise<T>,
        options?: { retries?: number; timeoutSeconds?: number },
      ) =>
        step.do(
          name,
          {
            retries: { limit: options?.retries ?? 2, delay: "5 seconds", backoff: "exponential" },
            timeout: `${options?.timeoutSeconds ?? 300} seconds`,
          },
          async () => {
            try {
              return (await task()) as never;
            } catch (error) {
              if ((error as { retryable?: boolean }).retryable === false) {
                throw new NonRetryableError(error instanceof Error ? error.message : String(error));
              }
              throw error;
            }
          },
        ) as Promise<T>,
    };
    const merged = await runMergePipeline(
      pipelineDeps(this.env),
      event.payload.candidateId,
      runner,
    );
    // The instance output: which merged checkpoint this run produced.
    return { candidateId: merged.candidateId, checkpoint: merged.checkpoint.uri };
  }
}

/** apps/merge-runner in a Cloudflare Container, reading and writing R2 through its S3 API. */
export class MergeRunnerContainer extends Container<Env> {
  override defaultPort = 8080;
  override sleepAfter = "10m";

  constructor(ctx: ConstructorParameters<typeof Container>[0], env: Env) {
    super(ctx, env);
    const { config } = settings(env);
    this.envVars = {
      PORT: "8080",
      OBJECT_STORE: "s3",
      S3_ENDPOINT: config.R2_ACCOUNT_ID
        ? `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
        : "",
      S3_ACCESS_KEY_ID: config.R2_ACCESS_KEY_ID ?? "",
      S3_SECRET_ACCESS_KEY: config.R2_SECRET_ACCESS_KEY ?? "",
      S3_DELTAS_BUCKET: config.R2_DELTAS_BUCKET,
      S3_CHECKPOINTS_BUCKET: config.R2_CHECKPOINTS_BUCKET,
      MERGE_RUNNER_TOKEN: config.MERGE_RUNNER_TOKEN ?? "",
    };
  }
}

/** Only reachable through service bindings. */
export class InternalApi extends WorkerEntrypoint<Env> {
  override fetch(request: Request): Promise<Response> {
    return handle(this.env, request, "internal");
  }
}

export default {
  fetch: (request, env) => handle(env, request, "public"),

  async queue(batch, env) {
    const { logger } = settings(env);
    const client = coordinator(env);
    for (const message of batch.messages) {
      const event = message.body as UpdateAcceptedEvent;
      try {
        await client.coordinator.reportRoundProgress({
          roundId: event.roundId,
          nodeId: event.nodeId,
          updateId: event.updateId,
        });
        message.ack();
      } catch (error) {
        // An unknown node or a closed round will never be accepted: drop it.
        if (error instanceof FederationApiError && (error.status === 404 || error.status === 409)) {
          logger.warn("round progress refused by the coordinator", {
            updateId: event.updateId,
            code: error.code,
          });
          message.ack();
        } else {
          message.retry({ delaySeconds: Math.min(300, 2 ** message.attempts) });
        }
      }
    }
  },
} satisfies ExportedHandler<Env>;
