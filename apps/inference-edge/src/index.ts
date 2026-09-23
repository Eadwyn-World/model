/**
 * Node entrypoint (local development and self-hosting, e.g. on a Pod GPU as
 * the upstream the Cloudflare edge proxies to). Cloudflare: src/worker/index.ts.
 */
import { join } from "node:path";
import { createFederationClient } from "@eadwyn/federation-sdk";
import {
  createModelRegistry,
  genesisRegistry,
  registryCodec,
  seedRegistry,
} from "@eadwyn/model-registry";
import { createLogger } from "@eadwyn/service-kit";
import { createFileStore, loadEnv, startService } from "@eadwyn/service-kit/node";
import { createInferenceEdgeApp } from "./app";
import { createMockBackend, createUpstreamBackend, type InferenceBackend } from "./backends";
import { createMemoryCache } from "./cache";
import { EnvSchema } from "./env";
import { syncServedModel } from "./sync";

const env = loadEnv(EnvSchema);
const logger = createLogger({
  service: "inference-edge",
  format: env.LOG_FORMAT,
  level: env.LOG_LEVEL,
});
const federation = createFederationClient({
  coordinatorUrl: env.COORDINATOR_URL,
  timeoutMs: 3_000,
});

// The edge keeps its own registry: what it serves. Sync pulls published versions in.
const registry = createModelRegistry({
  store: createFileStore({
    filePath: join(env.DATA_DIR, "served-model-registry.json"),
    ...registryCodec(env.SEED_MODE === "genesis" ? () => genesisRegistry() : () => seedRegistry()),
  }),
});

const backend: InferenceBackend =
  env.UPSTREAM_INFERENCE_URL && env.INFERENCE_BACKEND !== "mock"
    ? createUpstreamBackend({
        url: env.UPSTREAM_INFERENCE_URL,
        accessClientId: env.UPSTREAM_ACCESS_CLIENT_ID,
        accessClientSecret: env.UPSTREAM_ACCESS_CLIENT_SECRET,
        bearerToken: env.UPSTREAM_TOKEN,
      })
    : createMockBackend();

const fetchPublished = () => federation.coordinator.getCurrentModel();
const app = createInferenceEdgeApp({
  registry,
  backend,
  logger,
  cache: backend.name === "mock" ? undefined : createMemoryCache(),
  cacheTtlSeconds: env.INFERENCE_CACHE_TTL_SECONDS,
  fetchPublished,
  operatorToken: env.OPERATOR_TOKEN,
});

const sync = async () => {
  const result = await syncServedModel(registry, fetchPublished);
  if (result.adopted) logger.info("adopted published model", { version: result.servedVersion });
};
sync().catch(() => undefined);
setInterval(() => sync().catch(() => undefined), env.SYNC_INTERVAL_SECONDS * 1000).unref();

startService(app, {
  port: env.PORT,
  host: env.HOST,
  logger,
  internalToken: env.INTERNAL_API_TOKEN,
});
