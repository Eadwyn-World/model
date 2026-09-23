/**
 * LocalNode — the mock training node client.
 *
 * Lifecycle: registerNode() → prepareLocalUpdate() → submitUpdate().
 * The node keeps its private key; the coordinator keeps its public key; the
 * aggregator verifies every update against it. Data never leaves the node —
 * only the signed, content-addressed update does.
 */
import { randomUUID } from "node:crypto";
import { createFederationClient, type FederationClient } from "@eadwyn/federation-sdk";
import {
  type HeartbeatResponse,
  type NodeCapabilities,
  type NodeIdentity,
  type NodeRole,
  type RegisterNodeResponse,
  type SubmitUpdateResponse,
  type TrainingRound,
  type TrainingUpdate,
  TrainingUpdateSchema,
  type UnsignedTrainingUpdate,
} from "@eadwyn/shared-protocol";
import {
  generateNodeKeyPair,
  type NodeKeyPair,
  signTrainingUpdate,
} from "@eadwyn/shared-protocol/signing";
import { simulateLocalTraining } from "./mock-training";

export interface LocalNodeConfig {
  displayName: string;
  role?: NodeRole;
  podId?: string;
  region?: string;
  capabilities?: NodeCapabilities;
  coordinatorUrl: string;
  aggregatorUrl: string;
  /** Persisted node keys. A fresh pair is generated when omitted. */
  keyPair?: NodeKeyPair;
  /** Seed for deterministic mock training. */
  seed?: number;
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
}

export interface PrepareUpdateInput {
  samples: number;
  steps?: number;
  knowledgeItemIds?: string[];
}

export interface PreparedUpdate {
  update: TrainingUpdate;
  /** The delta bytes stay on the node until an artifact store exists. */
  delta: Uint8Array;
}

export interface LocalNode {
  readonly keyPair: NodeKeyPair;
  readonly identity: NodeIdentity | undefined;
  readonly activeRound: TrainingRound | undefined;
  readonly client: FederationClient;
  registerNode(): Promise<RegisterNodeResponse>;
  heartbeat(): Promise<HeartbeatResponse>;
  prepareLocalUpdate(input: PrepareUpdateInput): Promise<PreparedUpdate>;
  submitUpdate(update: TrainingUpdate): Promise<SubmitUpdateResponse>;
}

export function createLocalNode(config: LocalNodeConfig): LocalNode {
  const keyPair = config.keyPair ?? generateNodeKeyPair();
  const now = config.now ?? (() => new Date());
  const client = createFederationClient({
    coordinatorUrl: config.coordinatorUrl,
    aggregatorUrl: config.aggregatorUrl,
    fetch: config.fetch,
    timeoutMs: config.timeoutMs,
  });

  let identity: NodeIdentity | undefined;
  let activeRound: TrainingRound | undefined;
  let updatesPrepared = 0;

  const requireRegistered = (): { identity: NodeIdentity; activeRound: TrainingRound } => {
    if (!identity || !activeRound) {
      throw new Error("node is not registered; call registerNode() first");
    }
    return { identity, activeRound };
  };

  return {
    keyPair,
    client,
    get identity() {
      return identity;
    },
    get activeRound() {
      return activeRound;
    },

    async registerNode() {
      const response = await client.coordinator.registerNode({
        displayName: config.displayName,
        role: config.role ?? "device",
        podId: config.podId,
        region: config.region,
        publicKey: keyPair.publicKey,
        capabilities: config.capabilities ?? { compute: "cpu" },
      });
      identity = response.node;
      activeRound = response.activeRound;
      return response;
    },

    async heartbeat() {
      const { identity: me } = requireRegistered();
      const response = await client.coordinator.heartbeat(me.nodeId);
      identity = response.node;
      activeRound = response.activeRound;
      return response;
    },

    async prepareLocalUpdate(input) {
      const { identity: me, activeRound: round } = requireRegistered();
      const steps = input.steps ?? Math.max(10, Math.round(input.samples / 8));
      updatesPrepared += 1;
      const trained = simulateLocalTraining({
        seed: (config.seed ?? 1) * 1_000 + updatesPrepared,
        samples: input.samples,
        steps,
      });
      const updateId = randomUUID();
      const unsigned: UnsignedTrainingUpdate = {
        updateId,
        nodeId: me.nodeId,
        roundId: round.roundId,
        baseModelVersion: round.baseModelVersion,
        delta: {
          uri: `local://${me.nodeId}/rounds/${round.roundId}/${updateId}.safetensors`,
          sha256: trained.sha256,
          bytes: trained.delta.byteLength,
        },
        metrics: trained.metrics,
        knowledgeItemIds: input.knowledgeItemIds ?? [],
        createdAt: now().toISOString(),
      };
      const update = TrainingUpdateSchema.parse({
        ...unsigned,
        signature: signTrainingUpdate(unsigned, keyPair.privateKey),
      });
      return { update, delta: trained.delta };
    },

    async submitUpdate(update) {
      requireRegistered();
      return client.aggregator.submitUpdate(update);
    },
  };
}
