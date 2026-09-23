import { join } from "node:path";
import { createModelRegistry } from "@eadwyn/model-registry";
import { createLogger, startService } from "@eadwyn/service-kit";
import { createCoordinatorApp } from "./app";
import { loadCoordinatorEnv } from "./env";
import { createCoordinatorStore } from "./state";

const env = loadCoordinatorEnv();
const logger = createLogger({
  service: "coordinator",
  format: env.LOG_FORMAT,
  level: env.LOG_LEVEL,
});

const app = createCoordinatorApp({
  store: createCoordinatorStore(join(env.DATA_DIR, "coordinator.json")),
  registry: createModelRegistry({ filePath: join(env.DATA_DIR, "model-registry.json") }),
  logger,
  config: {
    expectedNodes: env.COORDINATOR_EXPECTED_NODES,
    onlineWindowMinutes: env.COORDINATOR_ONLINE_WINDOW_MINUTES,
  },
});

startService(app, { port: env.PORT, host: env.HOST, logger });
