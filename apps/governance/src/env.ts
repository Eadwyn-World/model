import { z } from "zod";

export const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4103),
  HOST: z.string().default("0.0.0.0"),
  DATA_DIR: z.string().default("./data"),
  LOG_FORMAT: z.enum(["pretty", "json"]).default("pretty"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  COORDINATOR_URL: z.url().default("http://localhost:4101"),
  GOVERNANCE_APPROVAL_QUORUM: z.coerce.number().int().positive().default(2),
  GOVERNANCE_REJECTION_QUORUM: z.coerce.number().int().positive().default(1),
  SEED_MODE: z.enum(["fixtures", "genesis"]).default("fixtures"),
  /** `access` verifies Cloudflare Access identities; `none` trusts the body (local development only). */
  REVIEWER_AUTH: z.enum(["access", "none"]).default("none"),
  ACCESS_TEAM_DOMAIN: z.string().optional(),
  ACCESS_AUD: z.string().optional(),
  ACCESS_JWKS: z.string().optional(),
  /** Node only: when set, internal routes require `Authorization: Bearer <token>`. */
  INTERNAL_API_TOKEN: z.string().min(16).optional(),
});
export type Env = z.output<typeof EnvSchema>;
