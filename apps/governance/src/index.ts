/**
 * Node entrypoint (local development and self-hosting).
 * The Cloudflare entrypoint is src/worker/index.ts; both run the same routes.
 */
import { join } from "node:path";
import { createFederationClient } from "@eadwyn/federation-sdk";
import { createLogger } from "@eadwyn/service-kit";
import { createFileStore, loadEnv, startService } from "@eadwyn/service-kit/node";
import { createGovernanceApp } from "./app";
import { createDocumentGovernanceBackend } from "./backend";
import { EnvSchema } from "./env";
import { createReviewerResolver } from "./reviewers";
import { governanceCodec } from "./state";

const env = loadEnv(EnvSchema);
const logger = createLogger({
  service: "governance",
  format: env.LOG_FORMAT,
  level: env.LOG_LEVEL,
});
const federation = createFederationClient({
  coordinatorUrl: env.COORDINATOR_URL,
  timeoutMs: 3_000,
  headers: env.INTERNAL_API_TOKEN ? { authorization: `Bearer ${env.INTERNAL_API_TOKEN}` } : {},
});

const backend = createDocumentGovernanceBackend({
  store: createFileStore({
    filePath: join(env.DATA_DIR, "governance.json"),
    ...governanceCodec(env.SEED_MODE),
  }),
  quorums: {
    approvalQuorum: env.GOVERNANCE_APPROVAL_QUORUM,
    rejectionQuorum: env.GOVERNANCE_REJECTION_QUORUM,
  },
  publish: async (candidate) => {
    const { model } = await federation.coordinator.publishModel({
      candidateId: candidate.candidateId,
      roundId: candidate.roundId,
      parentVersion: candidate.baseModelVersion,
      checkpoint: candidate.checkpoint,
      changelog: candidate.summary,
    });
    return { version: model.version };
  },
  logger,
});

const app = createGovernanceApp({
  backend,
  resolveReviewer: createReviewerResolver({
    mode: env.REVIEWER_AUTH,
    teamDomain: env.ACCESS_TEAM_DOMAIN,
    audience: env.ACCESS_AUD,
    jwks: env.ACCESS_JWKS,
  }),
  logger,
});

// Approved merges whose publish failed (coordinator down) are retried here;
// on Cloudflare each merge's Durable Object alarm does the same.
setInterval(() => {
  backend
    .retryPendingPublications()
    .catch((error) => logger.warn("publish retry failed", { error }));
}, 30_000).unref();

startService(app, {
  port: env.PORT,
  host: env.HOST,
  logger,
  internalToken: env.INTERNAL_API_TOKEN,
});
