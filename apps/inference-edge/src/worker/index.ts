/**
 * Cloudflare entrypoint for the inference edge.
 *
 *  - Answers with Workers AI (a LoRA-capable base model plus the Eadwyn
 *    adapter), or proxies to a Pod GPU (UPSTREAM_INFERENCE_URL, authenticated
 *    with an Access service token), or a labelled mock.
 *  - Caches real answers in KV, keyed by served version, backend, model,
 *    adapter and prompt.
 *  - Keeps its served registry (D1) in step with the coordinator: a Cron
 *    Trigger every five minutes, or `POST /v1/sync` for operators.
 */
import { WorkerEntrypoint } from "cloudflare:workers";
import { createFederationClient } from "@eadwyn/federation-sdk";
import {
  createModelRegistry,
  genesisRegistry,
  registryCodec,
  seedRegistry,
} from "@eadwyn/model-registry";
import {
  type Caller,
  createD1Store,
  createLogger,
  parseEnv,
  withCaller,
} from "@eadwyn/service-kit";
import type { Hono } from "hono";
import { createInferenceEdgeApp } from "../app";
import {
  createMockBackend,
  createUpstreamBackend,
  createWorkersAiBackend,
  type InferenceBackend,
  type WorkersAiRun,
} from "../backends";
import { createKvCache } from "../cache";
import { EnvSchema } from "../env";
import { syncServedModel } from "../sync";

function settings(env: Env) {
  const config = parseEnv(EnvSchema, env as unknown as Record<string, unknown>);
  const logger = createLogger({
    service: "inference-edge",
    format: "json",
    level: config.LOG_LEVEL,
  });
  return { config, logger };
}

function registryFor(env: Env) {
  const { config } = settings(env);
  return createModelRegistry({
    store: createD1Store({
      db: env.DB,
      name: "served-model-registry",
      ...registryCodec(
        config.SEED_MODE === "genesis" ? () => genesisRegistry() : () => seedRegistry(),
      ),
    }),
  });
}

function backendFor(env: Env): InferenceBackend {
  const { config } = settings(env);
  const ai = (env as { AI?: { run: WorkersAiRun } }).AI;
  const upstream = config.UPSTREAM_INFERENCE_URL
    ? createUpstreamBackend({
        url: config.UPSTREAM_INFERENCE_URL,
        accessClientId: config.UPSTREAM_ACCESS_CLIENT_ID,
        accessClientSecret: config.UPSTREAM_ACCESS_CLIENT_SECRET,
        bearerToken: config.UPSTREAM_TOKEN,
      })
    : undefined;
  const workersAi = ai
    ? createWorkersAiBackend({
        run: (model, inputs) => ai.run(model, inputs),
        model: config.WORKERS_AI_MODEL,
        adapter: config.WORKERS_AI_LORA,
      })
    : undefined;
  switch (config.INFERENCE_BACKEND) {
    case "mock":
      return createMockBackend();
    case "upstream":
      if (!upstream) throw new Error("INFERENCE_BACKEND=upstream needs UPSTREAM_INFERENCE_URL");
      return upstream;
    case "workers-ai":
      if (!workersAi) throw new Error("INFERENCE_BACKEND=workers-ai needs the AI binding");
      return workersAi;
    default:
      return upstream ?? workersAi ?? createMockBackend();
  }
}

function fetchPublishedFor(env: Env) {
  const client = createFederationClient({
    transports: { coordinator: env.COORDINATOR_INTERNAL.fetch.bind(env.COORDINATOR_INTERNAL) },
    timeoutMs: 10_000,
  });
  return () => client.coordinator.getCurrentModel();
}

const apps = new WeakMap<object, Hono>();

function appFor(env: Env): Hono {
  let app = apps.get(env);
  if (app) return app;
  const { config, logger } = settings(env);
  app = createInferenceEdgeApp({
    registry: registryFor(env),
    backend: backendFor(env),
    logger,
    cache: createKvCache(env.RESPONSE_CACHE),
    cacheTtlSeconds: config.INFERENCE_CACHE_TTL_SECONDS,
    fetchPublished: fetchPublishedFor(env),
    operatorToken: config.OPERATOR_TOKEN,
  });
  apps.set(env, app);
  return app;
}

function handle(env: Env, request: Request, caller: Caller): Promise<Response> {
  return Promise.resolve(appFor(env).fetch(withCaller(request, caller)));
}

/** Only reachable through service bindings (the web app, other services). */
export class InternalApi extends WorkerEntrypoint<Env> {
  override fetch(request: Request): Promise<Response> {
    return handle(this.env, request, "internal");
  }
}

export default {
  fetch: (request, env) => handle(env, request, "public"),

  async scheduled(_controller, env, ctx) {
    const { logger } = settings(env);
    ctx.waitUntil(
      syncServedModel(registryFor(env), fetchPublishedFor(env)).then((result) => {
        if (result.adopted)
          logger.info("adopted published model", { version: result.servedVersion });
        if (result.error) logger.warn("model sync failed", { error: result.error });
      }),
    );
  },
} satisfies ExportedHandler<Env>;
