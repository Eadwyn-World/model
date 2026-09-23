import { loadEnv, z } from "@eadwyn/service-kit";

export const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4101),
  HOST: z.string().default("0.0.0.0"),
  DATA_DIR: z.string().default("./data"),
  LOG_FORMAT: z.enum(["pretty", "json"]).default("pretty"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  COORDINATOR_EXPECTED_NODES: z.coerce.number().int().positive().default(128),
  COORDINATOR_ONLINE_WINDOW_MINUTES: z.coerce.number().int().positive().default(360),
});
export type Env = z.output<typeof EnvSchema>;

export const loadCoordinatorEnv = (): Env => loadEnv(EnvSchema);
