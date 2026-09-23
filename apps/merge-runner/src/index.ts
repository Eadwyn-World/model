import { createLogger, createS3ObjectStore, type ObjectStore } from "@eadwyn/service-kit";
import { createFileObjectStore, loadEnv, startService } from "@eadwyn/service-kit/node";
import { createMergeRunnerApp } from "./app";
import { EnvSchema } from "./env";

const env = loadEnv(EnvSchema);
const logger = createLogger({
  service: "merge-runner",
  format: env.LOG_FORMAT,
  level: env.LOG_LEVEL,
});

function objectStore(): ObjectStore {
  if (env.OBJECT_STORE === "filesystem") {
    return createFileObjectStore(env.OBJECT_STORE_DIR);
  }
  if (!env.S3_ENDPOINT || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
    throw new Error("OBJECT_STORE=s3 needs S3_ENDPOINT, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY");
  }
  return createS3ObjectStore({
    endpoint: env.S3_ENDPOINT,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    bucketNames: { deltas: env.S3_DELTAS_BUCKET, checkpoints: env.S3_CHECKPOINTS_BUCKET },
  });
}

const app = createMergeRunnerApp({
  store: objectStore(),
  logger,
  token: env.MERGE_RUNNER_TOKEN || undefined,
  runnerName: env.RUNNER_NAME,
});

// The runner's trust boundary is its job token (MERGE_RUNNER_TOKEN), not the caller header.
startService(app, {
  port: env.PORT,
  host: env.HOST,
  logger,
  internalToken: env.MERGE_RUNNER_TOKEN || undefined,
});
