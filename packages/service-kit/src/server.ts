/**
 * Boots a Hono app on Node with graceful shutdown.
 */
import { type ServerType, serve } from "@hono/node-server";
import type { Hono } from "hono";
import type { Logger } from "./logger";

export interface StartServiceOptions {
  port: number;
  host: string;
  logger: Logger;
}

export function startService(app: Hono, options: StartServiceOptions): ServerType {
  const { port, host, logger } = options;
  const server = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
    logger.info(`listening on http://${info.address}:${info.port}`);
  });

  const shutdown = (signal: string) => {
    logger.info(`received ${signal}, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5_000).unref();
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  return server;
}
