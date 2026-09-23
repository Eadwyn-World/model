import { join } from "node:path";
import { createFederationClient, FederationApiError } from "@eadwyn/federation-sdk";
import { createLogger, startService } from "@eadwyn/service-kit";
import { createAggregatorApp } from "./app";
import { loadAggregatorEnv } from "./env";
import { createAggregatorStore } from "./state";

const env = loadAggregatorEnv();
const logger = createLogger({
  service: "aggregator",
  format: env.LOG_FORMAT,
  level: env.LOG_LEVEL,
});

const federation = createFederationClient({
  coordinatorUrl: env.COORDINATOR_URL,
  governanceUrl: env.GOVERNANCE_URL,
  timeoutMs: 3_000,
});

// Public keys change only when a node re-registers, so a small cache is safe.
const publicKeys = new Map<string, string>();

const app = createAggregatorApp({
  store: createAggregatorStore(join(env.DATA_DIR, "aggregator.json")),
  logger,
  config: {
    maxDeltaBytes: env.AGGREGATOR_MAX_DELTA_BYTES,
    verifySignatures: env.AGGREGATOR_VERIFY_SIGNATURES,
  },
  resolvePublicKey: async (nodeId) => {
    const cached = publicKeys.get(nodeId);
    if (cached) return cached;
    try {
      const node = await federation.coordinator.getNode(nodeId);
      publicKeys.set(nodeId, node.publicKey);
      return node.publicKey;
    } catch (error) {
      if (error instanceof FederationApiError && error.status === 404) return null;
      throw error;
    }
  },
  onUpdateAccepted: (update) =>
    federation.coordinator.reportRoundProgress({
      roundId: update.roundId,
      nodeId: update.nodeId,
      updateId: update.updateId,
    }),
  forwardCandidate: (candidate) => federation.governance.submitCandidate(candidate),
});

startService(app, { port: env.PORT, host: env.HOST, logger });
