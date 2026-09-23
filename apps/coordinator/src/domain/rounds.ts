import { randomUUID } from "node:crypto";
import { conflict } from "@eadwyn/service-kit";
import type { TrainingRound } from "@eadwyn/shared-protocol";
import type { CoordinatorState } from "../state";

const OPEN_STATUSES = new Set<TrainingRound["status"]>(["collecting", "aggregating", "reviewing"]);

export function findActiveRound(state: CoordinatorState): TrainingRound | undefined {
  return state.rounds.find((r) => OPEN_STATUSES.has(r.status));
}

export function openRound(
  state: CoordinatorState,
  input: { baseModelVersion: string; expectedNodes: number; now: Date },
): TrainingRound {
  const number = state.rounds.reduce((max, r) => Math.max(max, r.number), 0) + 1;
  const round: TrainingRound = {
    roundId: randomUUID(),
    number,
    baseModelVersion: input.baseModelVersion,
    status: "collecting",
    startedAt: input.now.toISOString(),
    expectedNodes: input.expectedNodes,
    participatingNodeIds: [],
    updatesReceived: 0,
  };
  state.rounds.push(round);
  return round;
}

/** The active round, opened on demand so the federation never has "no round". */
export function ensureActiveRound(
  state: CoordinatorState,
  input: { baseModelVersion: string; expectedNodes: number; now: Date },
): TrainingRound {
  return findActiveRound(state) ?? openRound(state, input);
}

export function recordProgress(
  state: CoordinatorState,
  input: { roundId: string; nodeId: string; updateId: string; now: Date },
): TrainingRound {
  const round = findActiveRound(state);
  if (!round || round.roundId !== input.roundId) {
    throw conflict("round_not_active", `round ${input.roundId} is not the active round`);
  }
  if (!round.participatingNodeIds.includes(input.nodeId)) {
    round.participatingNodeIds.push(input.nodeId);
  }
  round.updatesReceived += 1;
  state.lastSyncAt = input.now.toISOString();
  return round;
}

/**
 * Called when a merge is published: the round that produced it is marked
 * published, any other open round is closed (its base is now stale), and a
 * fresh round opens on the new version.
 */
export function rollRoundsAfterPublish(
  state: CoordinatorState,
  input: { publishedRoundId: string; newVersion: string; expectedNodes: number; now: Date },
): TrainingRound {
  for (const round of state.rounds) {
    if (!OPEN_STATUSES.has(round.status)) continue;
    round.status = round.roundId === input.publishedRoundId ? "published" : "closed";
    round.closesAt = input.now.toISOString();
  }
  const published = state.rounds.find((r) => r.roundId === input.publishedRoundId);
  if (published && published.status !== "published") {
    published.status = "published";
    published.closesAt = input.now.toISOString();
  }
  return openRound(state, {
    baseModelVersion: input.newVersion,
    expectedNodes: input.expectedNodes,
    now: input.now,
  });
}
