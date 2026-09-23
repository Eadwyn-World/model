import { z } from "zod";

export const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4101),
  HOST: z.string().default("0.0.0.0"),
  DATA_DIR: z.string().default("./data"),
  LOG_FORMAT: z.enum(["pretty", "json"]).default("pretty"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  COORDINATOR_EXPECTED_NODES: z.coerce.number().int().positive().default(128),
  COORDINATOR_ONLINE_WINDOW_MINUTES: z.coerce.number().int().positive().default(360),
  SEED_MODE: z.enum(["fixtures", "genesis"]).default("fixtures"),
  /** Node only: when set, internal routes require `Authorization: Bearer <token>`. */
  INTERNAL_API_TOKEN: z.string().min(16).optional(),
});
export type Env = z.output<typeof EnvSchema>;
