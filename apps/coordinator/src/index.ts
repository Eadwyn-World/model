/**
 * Node entrypoint (local development and self-hosting).
 * The Cloudflare entrypoint is src/worker/index.ts; both build the same app.
 */
import { join } from "node:path";
import {
  createModelRegistry,
  genesisRegistry,
  registryCodec,
  seedRegistry,
} from "@eadwyn/model-registry";
import { createLogger } from "@eadwyn/service-kit";
import { createFileStore, loadEnv, startService } from "@eadwyn/service-kit/node";
import { createCoordinatorApp } from "./app";
import { EnvSchema } from "./env";
import { coordinatorCodec } from "./state";

const env = loadEnv(EnvSchema);
const logger = createLogger({
  service: "coordinator",
  format: env.LOG_FORMAT,
  level: env.LOG_LEVEL,
});

const app = createCoordinatorApp({
  store: createFileStore({
    filePath: join(env.DATA_DIR, "coordinator.json"),
    ...coordinatorCodec(env.SEED_MODE),
  }),
  registry: createModelRegistry({
    store: createFileStore({
      filePath: join(env.DATA_DIR, "model-registry.json"),
      ...registryCodec(env.SEED_MODE === "genesis" ? genesisRegistry : () => seedRegistry()),
    }),
  }),
  logger,
  config: {
    expectedNodes: env.COORDINATOR_EXPECTED_NODES,
    onlineWindowMinutes: env.COORDINATOR_ONLINE_WINDOW_MINUTES,
  },
});

startService(app, {
  port: env.PORT,
  host: env.HOST,
  logger,
  internalToken: env.INTERNAL_API_TOKEN,
});
