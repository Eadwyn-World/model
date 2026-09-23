import { loadEnv, z } from "@eadwyn/service-kit";

export const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4104),
  HOST: z.string().default("0.0.0.0"),
  DATA_DIR: z.string().default("./data"),
  LOG_FORMAT: z.enum(["pretty", "json"]).default("pretty"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});
export type Env = z.output<typeof EnvSchema>;

export const loadInferenceEdgeEnv = (): Env => loadEnv(EnvSchema);
