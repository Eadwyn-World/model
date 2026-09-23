/**
 * Cloudflare entrypoint for governance.
 *
 *  - `MergeReview` (Durable Object, one per merge candidate): serialises that
 *    candidate's votes and records its publish decision. It runs the same
 *    document backend as the Node service, over a document holding only its
 *    own candidate, then projects the result into D1.
 *  - D1: the projection listings read (pending merges, decision log,
 *    reviewer activity). Rebuilt from the objects by alarms if a write fails.
 *  - Publishing goes to the coordinator's InternalApi over a service binding.
 *    If the coordinator is unreachable, the object's alarm keeps retrying;
 *    the coordinator makes publishing idempotent per candidate.
 *  - Reviewers are identified by Cloudflare Access (REVIEWER_AUTH=access).
 */
import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { createFederationClient } from "@eadwyn/federation-sdk";
import {
  type Caller,
  createDurableObjectStore,
  createLogger,
  durableObjectDocumentExists,
  fromRpcResult,
  notFound,
  parseEnv,
  type RpcResult,
  toRpcResult,
  withCaller,
} from "@eadwyn/service-kit";
import type { MergeCandidate, MergeReview as MergeReviewRecord } from "@eadwyn/shared-protocol";
import type { Hono } from "hono";
import { createGovernanceApp } from "../app";
import {
  createDocumentGovernanceBackend,
  type DecisionInput,
  type DecisionOutcome,
  type GovernanceBackend,
  type Publisher,
} from "../backend";
import type { Quorums } from "../domain/review";
import { EnvSchema } from "../env";
import { createReviewerResolver } from "../reviewers";
import { emptyGovernanceState, GovernanceStateSchema } from "../state";
import {
  listProjectedDecisions,
  listProjectedReviewers,
  listProjectedReviews,
  projectionCounts,
  projectReviews,
} from "./projection";

const REVIEW_KEY = "review";
const RETRY_PROJECTION_MS = 10_000;
const RETRY_PUBLISH_MS = 60_000;

function settings(env: Env) {
  const config = parseEnv(EnvSchema, env as unknown as Record<string, unknown>);
  const quorums: Quorums = {
    approvalQuorum: config.GOVERNANCE_APPROVAL_QUORUM,
    rejectionQuorum: config.GOVERNANCE_REJECTION_QUORUM,
  };
  const logger = createLogger({ service: "governance", format: "json", level: config.LOG_LEVEL });
  return { config, quorums, logger };
}

function coordinatorPublisher(env: Env): Publisher {
  const client = createFederationClient({
    transports: { coordinator: env.COORDINATOR_INTERNAL.fetch.bind(env.COORDINATOR_INTERNAL) },
    timeoutMs: 10_000,
  });
  return async (candidate) => {
    const { model } = await client.coordinator.publishModel({
      candidateId: candidate.candidateId,
      roundId: candidate.roundId,
      parentVersion: candidate.baseModelVersion,
      checkpoint: candidate.checkpoint,
      changelog: candidate.summary,
    });
    return { version: model.version };
  };
}

export class MergeReview extends DurableObject<Env> {
  private readonly setup = settings(this.env);
  private readonly reviews: GovernanceBackend = createDocumentGovernanceBackend({
    store: createDurableObjectStore({
      storage: this.ctx.storage,
      key: REVIEW_KEY,
      seed: emptyGovernanceState,
      parse: (raw) => GovernanceStateSchema.parse(raw),
    }),
    quorums: this.setup.quorums,
    publish: coordinatorPublisher(this.env),
    logger: this.setup.logger,
  });

  submit(candidate: MergeCandidate): Promise<RpcResult<MergeCandidate>> {
    return toRpcResult(async () => {
      const accepted = await this.reviews.submitCandidate(candidate);
      await this.project();
      return accepted;
    });
  }

  review(candidateId: string): Promise<RpcResult<MergeReviewRecord>> {
    return toRpcResult(async () => {
      await this.requireExisting(candidateId);
      return this.reviews.getReview(candidateId);
    });
  }

  decide(candidateId: string, input: DecisionInput): Promise<RpcResult<DecisionOutcome>> {
    return toRpcResult(async () => {
      await this.requireExisting(candidateId);
      const outcome = await this.reviews.decide(candidateId, input);
      await this.project();
      if (outcome.review.publishRetrying) {
        await this.ctx.storage.setAlarm(Date.now() + RETRY_PUBLISH_MS);
      }
      return outcome;
    });
  }

  /** Retries a failed publish and repairs the D1 projection. */
  override async alarm(): Promise<void> {
    const pending = await this.reviews.retryPendingPublications();
    await this.project();
    if (pending > 0) {
      await this.ctx.storage.setAlarm(Date.now() + RETRY_PUBLISH_MS);
    }
  }

  private async requireExisting(candidateId: string): Promise<void> {
    if (!(await durableObjectDocumentExists(this.ctx.storage, REVIEW_KEY))) {
      throw notFound(`merge candidate ${candidateId}`);
    }
  }

  private async project(): Promise<void> {
    try {
      await projectReviews(this.env.DB, await this.reviews.listReviews("all"), new Date());
    } catch (error) {
      this.setup.logger.warn("D1 projection failed; retrying from alarm", { error });
      await this.ctx.storage.setAlarm(Date.now() + RETRY_PROJECTION_MS);
    }
  }
}

function durableBackend(env: Env): GovernanceBackend {
  const stub = (candidateId: string) =>
    env.MERGE_REVIEWS.get(env.MERGE_REVIEWS.idFromName(candidateId));
  const { quorums } = settings(env);
  return {
    listReviews: (status) => listProjectedReviews(env.DB, status),
    getReview: async (candidateId) => fromRpcResult(await stub(candidateId).review(candidateId)),
    submitCandidate: async (candidate) =>
      fromRpcResult(await stub(candidate.candidateId).submit(candidate)),
    decide: async (candidateId, input) =>
      fromRpcResult(await stub(candidateId).decide(candidateId, input)),
    listDecisions: (reviewerId) => listProjectedDecisions(env.DB, reviewerId),
    listReviewers: () => listProjectedReviewers(env.DB),
    // Each MergeReview object retries its own publish from an alarm.
    retryPendingPublications: async () => 0,
    health: async () => ({
      ...(await projectionCounts(env.DB)),
      approvalQuorum: quorums.approvalQuorum,
    }),
  };
}

const apps = new WeakMap<object, Hono>();

function appFor(env: Env): Hono {
  let app = apps.get(env);
  if (!app) {
    const { config, logger } = settings(env);
    app = createGovernanceApp({
      backend: durableBackend(env),
      resolveReviewer: createReviewerResolver({
        mode: config.REVIEWER_AUTH,
        teamDomain: config.ACCESS_TEAM_DOMAIN,
        audience: config.ACCESS_AUD,
        jwks: config.ACCESS_JWKS,
      }),
      logger,
    });
    apps.set(env, app);
  }
  return app;
}

function handle(env: Env, request: Request, caller: Caller): Promise<Response> {
  return Promise.resolve(appFor(env).fetch(withCaller(request, caller)));
}

/** Only reachable through service bindings (the aggregator's merge pipeline submits candidates here). */
export class InternalApi extends WorkerEntrypoint<Env> {
  override fetch(request: Request): Promise<Response> {
    return handle(this.env, request, "internal");
  }
}

export default {
  fetch: (request, env) => handle(env, request, "public"),
} satisfies ExportedHandler<Env>;
