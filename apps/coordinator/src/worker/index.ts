/**
 * Cloudflare entrypoint for the coordinator.
 *
 *  - `Federation` (Durable Object): the federation's single serialisation
 *    point. It owns the node registry and the rounds as one document in its
 *    own storage, so registration, round progress and the round rollover on
 *    publish are each one atomic step. The model registry lives in D1.
 *  - default `fetch`: the public API. Stamps callers as "public".
 *  - `InternalApi`: a named entrypoint only reachable through service
 *    bindings (governance, aggregator, inference edge). Stamps "internal",
 *    which is what unlocks publishing and round progress.
 *
 * Both entrypoints forward to the same Durable Object and the same Hono app
 * the Node server runs; only the storage backends differ.
 */
import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import {
  createModelRegistry,
  genesisRegistry,
  registryCodec,
  seedRegistry,
} from "@eadwyn/model-registry";
import {
  type Caller,
  createD1Store,
  createDurableObjectStore,
  createLogger,
  HttpError,
  parseEnv,
  withCallerBuffered,
} from "@eadwyn/service-kit";
import type { Hono } from "hono";
import { createCoordinatorApp } from "../app";
import { EnvSchema } from "../env";
import { coordinatorCodec } from "../state";

export class Federation extends DurableObject<Env> {
  private app: Hono | undefined;

  override async fetch(request: Request): Promise<Response> {
    this.app ??= this.build();
    return this.app.fetch(request);
  }

  private build(): Hono {
    const config = parseEnv(EnvSchema, this.env as unknown as Record<string, unknown>);
    const logger = createLogger({
      service: "coordinator",
      format: "json",
      level: config.LOG_LEVEL,
    });
    const registrySeed =
      config.SEED_MODE === "genesis" ? () => genesisRegistry() : () => seedRegistry();
    return createCoordinatorApp({
      store: createDurableObjectStore({
        storage: this.ctx.storage,
        key: "federation",
        ...coordinatorCodec(config.SEED_MODE),
      }),
      registry: createModelRegistry({
        store: createD1Store({
          db: this.env.DB,
          name: "model-registry",
          ...registryCodec(registrySeed),
        }),
      }),
      logger,
      config: {
        expectedNodes: config.COORDINATOR_EXPECTED_NODES,
        onlineWindowMinutes: config.COORDINATOR_ONLINE_WINDOW_MINUTES,
      },
    });
  }
}

async function forward(env: Env, request: Request, caller: Caller): Promise<Response> {
  let stamped: Request;
  try {
    stamped = await withCallerBuffered(request, caller);
  } catch (error) {
    if (error instanceof HttpError) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    throw error;
  }
  const federation = env.FEDERATION.get(env.FEDERATION.idFromName("federation"));
  return federation.fetch(stamped);
}

/** Only reachable through service bindings: `{ service: "eadwyn-coordinator", entrypoint: "InternalApi" }`. */
export class InternalApi extends WorkerEntrypoint<Env> {
  override fetch(request: Request): Promise<Response> {
    return forward(this.env, request, "internal");
  }
}

export default {
  fetch: (request, env) => forward(env, request, "public"),
} satisfies ExportedHandler<Env>;
