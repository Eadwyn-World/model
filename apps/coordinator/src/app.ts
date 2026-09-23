/**
 * Coordinator HTTP surface.
 *
 * The coordinator is a scheduler and a registry, not an owner: it knows which
 * nodes exist, which round is open and which model version is current. It
 * never sees training data and never decides what gets merged.
 */
import { type ModelRegistry, ModelRegistryError } from "@eadwyn/model-registry";
import {
  conflict,
  createServiceApp,
  type Logger,
  notFound,
  requireInternal,
  validateJson,
} from "@eadwyn/service-kit";
import {
  type ModelVersionListResponse,
  type NodeListResponse,
  PublishModelRequestSchema,
  type PublishModelResponse,
  RegisterNodeRequestSchema,
  type RegisterNodeResponse,
  RoundProgressRequestSchema,
  type RoundProgressResponse,
} from "@eadwyn/shared-protocol";
import type { Hono } from "hono";
import { findNode, registerNode, touchNode } from "./domain/nodes";
import {
  ensureActiveRound,
  findActiveRound,
  recordProgress,
  rollRoundsAfterPublish,
} from "./domain/rounds";
import { buildFederationStats } from "./domain/stats";
import type { CoordinatorStore } from "./state";

export interface CoordinatorConfig {
  expectedNodes: number;
  onlineWindowMinutes: number;
}

export interface CoordinatorDeps {
  store: CoordinatorStore;
  registry: ModelRegistry;
  logger: Logger;
  config: CoordinatorConfig;
  now?: () => Date;
  version?: string;
}

export function createCoordinatorApp(deps: CoordinatorDeps): Hono {
  const { store, registry, logger, config } = deps;
  const now = deps.now ?? (() => new Date());

  const app = createServiceApp({
    name: "coordinator",
    version: deps.version ?? "0.1.0",
    description: "Node registry, training rounds and the global model version.",
    logger,
    healthDetails: async () => {
      const current = await registry.getCurrent();
      const state = await store.read();
      return { globalModelVersion: current.version, registeredNodes: state.nodes.length };
    },
  });

  /** Reads the active round, opening one only if the state has none (reads never write). */
  const activeRound = async () => {
    const existing = findActiveRound(await store.read());
    if (existing) return existing;
    const current = await registry.getCurrent();
    return store.update((state) =>
      ensureActiveRound(state, {
        baseModelVersion: current.version,
        expectedNodes: config.expectedNodes,
        now: now(),
      }),
    );
  };

  // --- federation readout ---------------------------------------------------
  app.get("/v1/stats", async (c) => {
    const current = await registry.getCurrent();
    const round = await activeRound();
    const state = await store.read();
    return c.json(
      buildFederationStats({
        state,
        current,
        activeRound: round,
        now: now(),
        onlineWindowMinutes: config.onlineWindowMinutes,
      }),
    );
  });

  // --- model -----------------------------------------------------------------
  app.get("/v1/model/current", async (c) => c.json(await registry.getCurrent()));

  app.get("/v1/model/versions", async (c) => {
    const [current, versions] = await Promise.all([registry.getCurrent(), registry.listVersions()]);
    const body: ModelVersionListResponse = { current: current.version, versions };
    return c.json(body);
  });

  // Only governance may publish, and only through its service binding (or the
  // internal token on Node). Publishing is idempotent per merge candidate.
  app.post(
    "/v1/model/publish",
    requireInternal(),
    validateJson(PublishModelRequestSchema),
    async (c) => {
      const input = c.req.valid("json");
      const at = now();
      let published: Awaited<ReturnType<ModelRegistry["publish"]>>;
      try {
        published = await registry.publish({
          parentVersion: input.parentVersion,
          checkpoint: input.checkpoint,
          changelog: input.changelog,
          mergeCandidateId: input.candidateId,
          publishedAt: at.toISOString(),
        });
      } catch (error) {
        if (error instanceof ModelRegistryError) {
          throw conflict(error.code, error.message);
        }
        throw error;
      }
      const model = published.model;
      if (!published.created) {
        // A retried publish: the version exists and the rounds already rolled.
        const body: PublishModelResponse = { model, nextRound: await activeRound() };
        return c.json(body, 200);
      }
      const nextRound = await store.update((state) =>
        rollRoundsAfterPublish(state, {
          publishedRoundId: input.roundId,
          newVersion: model.version,
          expectedNodes: config.expectedNodes,
          now: at,
        }),
      );
      logger.info("published new global model", {
        version: model.version,
        candidateId: input.candidateId,
        nextRound: nextRound.number,
      });
      const body: PublishModelResponse = { model, nextRound };
      return c.json(body, 201);
    },
  );

  // --- rounds ----------------------------------------------------------------
  app.get("/v1/rounds/active", async (c) => c.json(await activeRound()));

  // Reported by the aggregator (directly on Node, via a queue on Cloudflare).
  app.post(
    "/v1/rounds/active/progress",
    requireInternal(),
    validateJson(RoundProgressRequestSchema),
    async (c) => {
      const input = c.req.valid("json");
      await activeRound();
      const round = await store.update((state) => {
        if (!findNode(state, input.nodeId)) {
          throw notFound(`node ${input.nodeId}`);
        }
        touchNode(state, input.nodeId, now());
        return recordProgress(state, { ...input, now: now() });
      });
      const body: RoundProgressResponse = { round };
      return c.json(body);
    },
  );

  // --- nodes -----------------------------------------------------------------
  app.get("/v1/nodes", async (c) => {
    const state = await store.read();
    const body: NodeListResponse = { nodes: state.nodes, total: state.nodes.length };
    return c.json(body);
  });

  app.get("/v1/nodes/:nodeId", async (c) => {
    const node = findNode(await store.read(), c.req.param("nodeId"));
    if (!node) {
      throw notFound(`node ${c.req.param("nodeId")}`);
    }
    return c.json(node);
  });

  app.post("/v1/nodes/register", validateJson(RegisterNodeRequestSchema), async (c) => {
    const input = c.req.valid("json");
    const round = await activeRound();
    const { node, created } = await store.update((state) => registerNode(state, input, now()));
    logger.info(created ? "node registered" : "node re-registered", {
      nodeId: node.nodeId,
      displayName: node.displayName,
      role: node.role,
    });
    const body: RegisterNodeResponse = { node, activeRound: round };
    return c.json(body, created ? 201 : 200);
  });

  app.post("/v1/nodes/:nodeId/heartbeat", async (c) => {
    const round = await activeRound();
    const node = await store.update((state) => touchNode(state, c.req.param("nodeId"), now()));
    if (!node) {
      throw notFound(`node ${c.req.param("nodeId")}`);
    }
    const body: RegisterNodeResponse = { node, activeRound: round };
    return c.json(body);
  });

  return app;
}
