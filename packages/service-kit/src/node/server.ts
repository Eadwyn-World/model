/**
 * Boots a Hono app on Node with graceful shutdown, stamping the caller.
 */
import { type ServerType, serve } from "@hono/node-server";
import type { Hono } from "hono";
import { type Caller, safeEqual, withCaller } from "../auth";
import type { Logger } from "../logger";

export interface StartServiceOptions {
  port: number;
  host: string;
  logger: Logger;
  /**
   * When set, only requests bearing `Authorization: Bearer <token>` count as
   * internal. When unset (local development), every caller is trusted.
   */
  internalToken?: string;
}

export function callerForNodeRequest(request: Request, internalToken: string | undefined): Caller {
  if (!internalToken) return "internal";
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  return token && safeEqual(token, internalToken) ? "internal" : "public";
}

export function startService(app: Hono, options: StartServiceOptions): ServerType {
  const { port, host, logger, internalToken } = options;
  if (!internalToken) {
    logger.warn(
      "INTERNAL_API_TOKEN is not set: every caller is trusted as internal. Fine for local development; set it before exposing this service.",
    );
  }
  const server = serve(
    {
      fetch: (request: Request) =>
        app.fetch(withCaller(request, callerForNodeRequest(request, internalToken))),
      port,
      hostname: host,
    },
    (info) => {
      logger.info(`listening on http://${info.address}:${info.port}`);
    },
  );

  const shutdown = (signal: string) => {
    logger.info(`received ${signal}, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5_000).unref();
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  return server;
}
