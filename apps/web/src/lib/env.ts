/**
 * Web app configuration. Server-only values come from the process env;
 * `NEXT_PUBLIC_*` values are inlined into the client bundle at build time.
 */
import { z } from "zod";

const ServerEnvSchema = z.object({
  COORDINATOR_URL: z.url().default("http://localhost:4101"),
  GOVERNANCE_URL: z.url().default("http://localhost:4103"),
  EADWYN_DATA_SOURCE: z.enum(["auto", "mock", "live"]).default("auto"),
});

export type ServerEnv = z.output<typeof ServerEnvSchema>;

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  cached ??= ServerEnvSchema.parse(process.env);
  return cached;
}

export const SOURCE_URL =
  process.env.NEXT_PUBLIC_SOURCE_URL ?? "https://github.com/Eadwyn-World/model";
