/** AggregatorRepository over D1 tables (the Cloudflare adapter). */
import { conflict } from "@eadwyn/service-kit";
import {
  type MergeCandidate,
  MergeCandidateSchema,
  type MergePipeline,
  MergePipelineSchema,
  type StoredUpdate,
  StoredUpdateSchema,
} from "@eadwyn/shared-protocol";
import type { AggregatorRepository } from "../ports";

const parseUpdate = (row: { body: string }) => StoredUpdateSchema.parse(JSON.parse(row.body));
const parseCandidate = (row: { body: string }) => MergeCandidateSchema.parse(JSON.parse(row.body));

export function createD1Repository(db: D1Database): AggregatorRepository {
  return {
    async insertUpdate(update: StoredUpdate) {
      try {
        await db
          .prepare(
            "INSERT INTO updates (update_id, round_id, node_id, body, received_at) VALUES (?, ?, ?, ?, ?)",
          )
          .bind(
            update.updateId,
            update.roundId,
            update.nodeId,
            JSON.stringify(update),
            update.receivedAt,
          )
          .run();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("UNIQUE constraint failed: updates.update_id")) {
          throw conflict("duplicate_update", `update ${update.updateId} was already received`);
        }
        if (message.includes("UNIQUE constraint failed")) {
          throw conflict(
            "node_already_submitted",
            `node ${update.nodeId} already contributed to round ${update.roundId}`,
          );
        }
        throw error;
      }
    },
    async getUpdate(updateId) {
      const row = await db
        .prepare("SELECT body FROM updates WHERE update_id = ?")
        .bind(updateId)
        .first<{ body: string }>();
      return row ? parseUpdate(row) : undefined;
    },
    async hasUpdate(updateId) {
      return (
        (await db
          .prepare("SELECT 1 AS x FROM updates WHERE update_id = ?")
          .bind(updateId)
          .first()) !== null
      );
    },
    async hasNodeSubmitted(roundId, nodeId) {
      return (
        (await db
          .prepare("SELECT 1 AS x FROM updates WHERE round_id = ? AND node_id = ?")
          .bind(roundId, nodeId)
          .first()) !== null
      );
    },
    async listUpdates(roundId) {
      const statement = roundId
        ? db
            .prepare("SELECT body FROM updates WHERE round_id = ? ORDER BY received_at")
            .bind(roundId)
        : db.prepare("SELECT body FROM updates ORDER BY received_at");
      const { results } = await statement.all<{ body: string }>();
      return results.map(parseUpdate);
    },
    async insertCandidate(candidate: MergeCandidate, pipeline: MergePipeline) {
      await db
        .prepare(
          "INSERT INTO candidates (candidate_id, round_id, body, pipeline, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(
          candidate.candidateId,
          candidate.roundId,
          JSON.stringify(candidate),
          JSON.stringify(pipeline),
          candidate.createdAt,
        )
        .run();
    },
    async getCandidate(candidateId) {
      const row = await db
        .prepare("SELECT body, pipeline FROM candidates WHERE candidate_id = ?")
        .bind(candidateId)
        .first<{ body: string; pipeline: string | null }>();
      if (!row) return undefined;
      return {
        candidate: parseCandidate(row),
        pipeline: row.pipeline ? MergePipelineSchema.parse(JSON.parse(row.pipeline)) : undefined,
      };
    },
    async listCandidates() {
      const { results } = await db
        .prepare("SELECT body FROM candidates ORDER BY created_at DESC")
        .all<{ body: string }>();
      return results.map(parseCandidate);
    },
    async saveCandidate(candidate) {
      await db
        .prepare("UPDATE candidates SET body = ? WHERE candidate_id = ?")
        .bind(JSON.stringify(candidate), candidate.candidateId)
        .run();
    },
    async savePipeline(candidateId, pipeline) {
      await db
        .prepare("UPDATE candidates SET pipeline = ? WHERE candidate_id = ?")
        .bind(JSON.stringify(pipeline), candidateId)
        .run();
    },
    async counts() {
      const row = await db
        .prepare(
          "SELECT (SELECT COUNT(*) FROM updates) AS updates, (SELECT COUNT(*) FROM candidates) AS candidates",
        )
        .first<{ updates: number; candidates: number }>();
      return row ?? { updates: 0, candidates: 0 };
    },
  };
}
