/** AggregatorRepository over one JSON document (the Node adapter). */
import { conflict, type JsonStore } from "@eadwyn/service-kit";
import type { AggregatorRepository } from "../ports";
import type { AggregatorState } from "../state";

export function createDocumentRepository(store: JsonStore<AggregatorState>): AggregatorRepository {
  return {
    insertUpdate: (update) =>
      store.update((state) => {
        if (state.updates.some((u) => u.updateId === update.updateId)) {
          throw conflict("duplicate_update", `update ${update.updateId} was already received`);
        }
        if (state.updates.some((u) => u.roundId === update.roundId && u.nodeId === update.nodeId)) {
          throw conflict(
            "node_already_submitted",
            `node ${update.nodeId} already contributed to round ${update.roundId}`,
          );
        }
        state.updates.push(update);
      }),
    getUpdate: async (updateId) =>
      (await store.read()).updates.find((u) => u.updateId === updateId),
    hasUpdate: async (updateId) =>
      (await store.read()).updates.some((u) => u.updateId === updateId),
    hasNodeSubmitted: async (roundId, nodeId) =>
      (await store.read()).updates.some((u) => u.roundId === roundId && u.nodeId === nodeId),
    listUpdates: async (roundId) => {
      const { updates } = await store.read();
      return roundId ? updates.filter((u) => u.roundId === roundId) : updates;
    },
    insertCandidate: (candidate, pipeline) =>
      store.update((state) => {
        state.candidates.push(candidate);
        state.pipelines[candidate.candidateId] = pipeline;
      }),
    getCandidate: async (candidateId) => {
      const state = await store.read();
      const candidate = state.candidates.find((c) => c.candidateId === candidateId);
      return candidate ? { candidate, pipeline: state.pipelines[candidateId] } : undefined;
    },
    listCandidates: async () =>
      (await store.read()).candidates.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    saveCandidate: (candidate) =>
      store.update((state) => {
        const index = state.candidates.findIndex((c) => c.candidateId === candidate.candidateId);
        if (index === -1) state.candidates.push(candidate);
        else state.candidates[index] = candidate;
      }),
    savePipeline: (candidateId, pipeline) =>
      store.update((state) => {
        state.pipelines[candidateId] = pipeline;
      }),
    counts: async () => {
      const state = await store.read();
      return { updates: state.updates.length, candidates: state.candidates.length };
    },
  };
}
