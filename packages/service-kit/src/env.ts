/**
 * Environment parsing with one rule: every variable has a schema and a
 * default. Runtime-agnostic: on Node the source is `process.env` (see
 * `loadEnv` in the node subpath); on Workers it is the `env` bindings object.
 */
import type { z } from "zod";

export function parseEnv<S extends z.ZodObject>(
  schema: S,
  source: Record<string, unknown>,
): z.output<S> {
  // Workers pass bindings (objects) alongside string vars; only strings are configuration.
  const vars: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string") vars[key] = value;
  }
  const result = schema.safeParse(vars);
  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  return result.data;
}
