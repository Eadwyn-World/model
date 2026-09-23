import { z } from "zod";

const flag = (fallback: boolean) =>
  z
    .enum(["true", "false"])
    .default(fallback ? "true" : "false")
    .transform((v) => v === "true");

export const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4102),
  HOST: z.string().default("0.0.0.0"),
  DATA_DIR: z.string().default("./data"),
  LOG_FORMAT: z.enum(["pretty", "json"]).default("pretty"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  COORDINATOR_URL: z.url().default("http://localhost:4101"),
  GOVERNANCE_URL: z.url().default("http://localhost:4103"),
  SEED_MODE: z.enum(["fixtures", "genesis"]).default("fixtures"),
  /** Verify Ed25519 signatures against the coordinator's node registry. Keep on. */
  AGGREGATOR_VERIFY_SIGNATURES: flag(true),
  /** Largest delta a node may upload per update (bytes). */
  AGGREGATOR_MAX_DELTA_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(64 * 1024 * 1024),
  /** HMAC secret for direct upload URLs. Generated per process on Node when unset. */
  UPLOAD_TOKEN_SECRET: z.string().min(16).optional(),
  UPLOAD_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  /** auto | inline | http | container */
  AGGREGATION_BACKEND: z.enum(["auto", "inline", "http", "container"]).default("auto"),
  INLINE_AGGREGATION_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(32 * 1024 * 1024),
  MERGE_RUNNER_URL: z.url().optional(),
  MERGE_RUNNER_TOKEN: z.string().optional(),
  /** Required for operator routes (start a merge) from outside the federation. */
  OPERATOR_TOKEN: z.string().min(16).optional(),
  /** Node only: when set, internal routes require `Authorization: Bearer <token>`. */
  INTERNAL_API_TOKEN: z.string().min(16).optional(),
  // Cloudflare only: R2's S3 API, for presigned direct-to-R2 uploads and the Container.
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_DELTAS_BUCKET: z.string().default("eadwyn-deltas"),
  R2_CHECKPOINTS_BUCKET: z.string().default("eadwyn-checkpoints"),
});
export type Env = z.output<typeof EnvSchema>;
