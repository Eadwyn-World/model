import { z } from "zod";

export const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4105),
  HOST: z.string().default("0.0.0.0"),
  LOG_FORMAT: z.enum(["pretty", "json"]).default("pretty"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  OBJECT_STORE: z.enum(["filesystem", "s3"]).default("filesystem"),
  OBJECT_STORE_DIR: z.string().default("../aggregator/data/objects"),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_DELTAS_BUCKET: z.string().default("eadwyn-deltas"),
  S3_CHECKPOINTS_BUCKET: z.string().default("eadwyn-checkpoints"),
  MERGE_RUNNER_TOKEN: z.string().optional(),
  /** How results label where the math ran: "container" in the image, "http" elsewhere. */
  RUNNER_NAME: z.string().default("http"),
});
export type Env = z.output<typeof EnvSchema>;
