import { join } from "node:path";
import { createFederationClient } from "@eadwyn/federation-sdk";
import { createLogger, startService } from "@eadwyn/service-kit";
import { createGovernanceApp } from "./app";
import { loadGovernanceEnv } from "./env";
import { createGovernanceStore } from "./state";

const env = loadGovernanceEnv();
const logger = createLogger({
  service: "governance",
  format: env.LOG_FORMAT,
  level: env.LOG_LEVEL,
});
const federation = createFederationClient({
  coordinatorUrl: env.COORDINATOR_URL,
  timeoutMs: 3_000,
});

const app = createGovernanceApp({
  store: createGovernanceStore(join(env.DATA_DIR, "governance.json")),
  logger,
  config: {
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
});

startService(app, { port: env.PORT, host: env.HOST, logger });
