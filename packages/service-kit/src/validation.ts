/**
 * zod validators for Hono routes, with the shared error envelope.
 */
import { zValidator } from "@hono/zod-validator";
import type { ZodType } from "zod";
import { z } from "zod";

/** Structural view of a zod error: works for both `ZodError` and the core `$ZodError`. */
export interface IssueCarrier {
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>;
}

export function invalidPayload(error: IssueCarrier, target = "body") {
  return {
    error: {
      code: "invalid_payload",
      message: `Request ${target} failed validation`,
      details: error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    },
  };
}

/** Validates the JSON body against `schema`; handlers read it with `c.req.valid("json")`. */
export function validateJson<T extends ZodType>(schema: T) {
  return zValidator("json", schema, (result, c) => {
    if (!result.success) {
      return c.json(invalidPayload(result.error, "body"), 400);
    }
  });
}

/** Validates query parameters against `schema`; handlers read them with `c.req.valid("query")`. */
export function validateQuery<T extends ZodType>(schema: T) {
  return zValidator("query", schema, (result, c) => {
    if (!result.success) {
      return c.json(invalidPayload(result.error, "query"), 400);
    }
  });
}

export { z };
