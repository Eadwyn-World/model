/**
 * Hono app factory used by every backend service.
 *
 * Gives each service the same skeleton: CORS (the APIs are public readouts),
 * request logging, `GET /` and `GET /health`, and a single error contract.
 */
import type { HealthResponse } from "@eadwyn/shared-protocol";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { HttpError } from "./errors";
import type { Logger } from "./logger";

export interface ServiceInfo {
  name: string;
  version: string;
  description: string;
}

export interface ServiceAppOptions extends ServiceInfo {
  logger: Logger;
  /** Extra fields surfaced in `GET /health` (e.g. the served model version). */
  healthDetails?: () => Promise<Record<string, unknown>> | Record<string, unknown>;
}

export function createServiceApp(options: ServiceAppOptions): Hono {
  const { name, version, description, logger, healthDetails } = options;
  const app = new Hono();
  const startedAt = Date.now();

  app.use("*", cors());
  app.use("*", async (c, next) => {
    const started = performance.now();
    await next();
    logger.debug(`${c.req.method} ${c.req.path}`, {
      status: c.res.status,
      ms: Math.round(performance.now() - started),
    });
  });

  app.get("/", (c) => c.json({ service: name, version, description, health: "/health" }));

  app.get("/health", async (c) => {
    let details: Record<string, unknown> | undefined;
    let status: HealthResponse["status"] = "ok";
    try {
      details = healthDetails ? await healthDetails() : undefined;
    } catch (error) {
      status = "degraded";
      details = { error: error instanceof Error ? error.message : String(error) };
    }
    const body: HealthResponse = {
      status,
      service: name,
      version,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      time: new Date().toISOString(),
      ...(details ? { details } : {}),
    };
    return c.json(body);
  });

  app.notFound((c) =>
    c.json(
      { error: { code: "not_found", message: `No route for ${c.req.method} ${c.req.path}` } },
      404,
    ),
  );

  app.onError(async (error, c) => {
    // A request refused before its body was read (auth, validation) must still
    // release the body; otherwise a Worker piping it to a Durable Object logs
    // "Can't read from request stream after response has been sent".
    if (c.req.raw.body && !c.req.raw.bodyUsed) {
      await c.req.raw.body.cancel().catch(() => undefined);
    }
    if (error instanceof HttpError) {
      return c.json(
        { error: { code: error.code, message: error.message, details: error.details } },
        error.status as ContentfulStatusCode,
      );
    }
    logger.error("unhandled error", { path: c.req.path, error });
    return c.json({ error: { code: "internal_error", message: "Unexpected server error" } }, 500);
  });

  return app;
}
