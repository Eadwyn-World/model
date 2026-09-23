/**
 * Node environment loading: a dotenv-style file (default `.env` in the cwd)
 * is applied without overriding anything already exported, then the whole
 * environment is validated.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { z } from "zod";
import { parseEnv } from "../env";

export interface LoadEnvOptions {
  /** Path to a dotenv file. Defaults to `.env` in the cwd. Pass `false` to skip. */
  envFile?: string | false;
  source?: Record<string, string | undefined>;
}

export function loadEnv<S extends z.ZodObject>(
  schema: S,
  options: LoadEnvOptions = {},
): z.output<S> {
  const { envFile = ".env", source = process.env } = options;
  if (envFile !== false) {
    applyEnvFile(resolve(envFile), source);
  }
  return parseEnv(schema, source);
}

/** Parses `KEY=value` lines; existing variables win over the file. */
export function applyEnvFile(path: string, target: Record<string, string | undefined>): void {
  if (!existsSync(path)) {
    return;
  }
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed
      .slice(0, separator)
      .trim()
      .replace(/^export\s+/, "");
    let value = trimmed.slice(separator + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted) value = value.slice(1, -1);
    if (key && target[key] === undefined) target[key] = value;
  }
}
