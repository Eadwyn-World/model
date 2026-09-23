import { loadEnv, z } from "@eadwyn/service-kit";

export const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4103),
  HOST: z.string().default("0.0.0.0"),
  DATA_DIR: z.string().default("./data"),
  LOG_FORMAT: z.enum(["pretty", "json"]).default("pretty"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  COORDINATOR_URL: z.url().default("http://localhost:4101"),
  GOVERNANCE_APPROVAL_QUORUM: z.coerce.number().int().positive().default(2),
  GOVERNANCE_REJECTION_QUORUM: z.coerce.number().int().positive().default(1),
});
export type Env = z.output<typeof EnvSchema>;

export const loadGovernanceEnv = (): Env => loadEnv(EnvSchema);
