import { join } from "node:path";
import { createModelRegistry } from "@eadwyn/model-registry";
import { createLogger, startService } from "@eadwyn/service-kit";
import { createInferenceEdgeApp } from "./app";
import { loadInferenceEdgeEnv } from "./env";

const env = loadInferenceEdgeEnv();
const logger = createLogger({
  service: "inference-edge",
  format: env.LOG_FORMAT,
  level: env.LOG_LEVEL,
});

// The edge keeps its own copy of the registry: what it serves, not what the
// coordinator has most recently published. Syncing the two is the next step.
const app = createInferenceEdgeApp({
  registry: createModelRegistry({ filePath: join(env.DATA_DIR, "served-model-registry.json") }),
  logger,
});

startService(app, { port: env.PORT, host: env.HOST, logger });
