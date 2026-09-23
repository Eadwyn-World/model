import type { FederationStats, ModelVersion, TrainingRound } from "@eadwyn/shared-protocol";
import type { CoordinatorState } from "../state";
import { countOnlineNodes } from "./nodes";

export function buildFederationStats(input: {
  state: CoordinatorState;
  current: ModelVersion;
  activeRound: TrainingRound;
  now: Date;
  onlineWindowMinutes: number;
}): FederationStats {
  const { state, current, activeRound, now, onlineWindowMinutes } = input;
  return {
    globalModelVersion: current.version,
    globalModelPublishedAt: current.publishedAt,
    activeRound,
    registeredNodes: state.nodes.length,
    onlineNodes: countOnlineNodes(state.nodes, now, onlineWindowMinutes),
    lastSyncAt: state.lastSyncAt,
    generatedAt: now.toISOString(),
  };
}
