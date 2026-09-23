import { z } from "zod";

export const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4104),
  HOST: z.string().default("0.0.0.0"),
  DATA_DIR: z.string().default("./data"),
  LOG_FORMAT: z.enum(["pretty", "json"]).default("pretty"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  COORDINATOR_URL: z.url().default("http://localhost:4101"),
  SEED_MODE: z.enum(["fixtures", "genesis"]).default("fixtures"),
  /** auto: upstream if UPSTREAM_INFERENCE_URL is set, else Workers AI if bound, else mock. */
  INFERENCE_BACKEND: z.enum(["auto", "mock", "workers-ai", "upstream"]).default("auto"),
  /** A LoRA-capable Workers AI base model. */
  WORKERS_AI_MODEL: z.string().default("@cf/mistral/mistral-7b-instruct-v0.2-lora"),
  /** Name or id of the Eadwyn adapter uploaded with `wrangler ai finetune create`. */
  WORKERS_AI_LORA: z.string().optional(),
  UPSTREAM_INFERENCE_URL: z.url().optional(),
  UPSTREAM_ACCESS_CLIENT_ID: z.string().optional(),
  UPSTREAM_ACCESS_CLIENT_SECRET: z.string().optional(),
  UPSTREAM_TOKEN: z.string().optional(),
  INFERENCE_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  SYNC_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
  OPERATOR_TOKEN: z.string().min(16).optional(),
  INTERNAL_API_TOKEN: z.string().min(16).optional(),
});
export type Env = z.output<typeof EnvSchema>;
