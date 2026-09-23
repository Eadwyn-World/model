import { loadEnv, z } from "@eadwyn/service-kit";

export const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4102),
  HOST: z.string().default("0.0.0.0"),
  DATA_DIR: z.string().default("./data"),
  LOG_FORMAT: z.enum(["pretty", "json"]).default("pretty"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  COORDINATOR_URL: z.url().default("http://localhost:4101"),
  GOVERNANCE_URL: z.url().default("http://localhost:4103"),
  AGGREGATOR_VERIFY_SIGNATURES: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  AGGREGATOR_MAX_DELTA_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(64 * 1024 * 1024),
});
export type Env = z.output<typeof EnvSchema>;

export const loadAggregatorEnv = (): Env => loadEnv(EnvSchema);
