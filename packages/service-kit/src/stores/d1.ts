/**
 * D1 variant of the store.
 *
 * D1 can be written by any isolate, anywhere, at the same time, so this
 * backend uses optimistic concurrency: every write is a single batch
 * (a transaction) that only takes effect if the document's revision is still
 * the one that was read. A lost race reloads and re-runs the mutation.
 *
 * Tables (see D1_DOCUMENT_STORE_SCHEMA; ship it in the service's migrations):
 *   eadwyn_documents(name, revision, chunks, updated_at)
 *   eadwyn_document_chunks(name, idx, revision, body)
 */
import { chunkString, createStoreFromBackend, newRevision } from "./core";
import type { JsonStore, StoreCodec } from "./types";

/** The subset of `D1Database` this store needs. */
export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  batch(statements: D1PreparedStatementLike[]): Promise<Array<{ meta: { changes?: number } }>>;
}

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  all<R = Record<string, unknown>>(): Promise<{ results: R[] }>;
}

export const D1_DOCUMENT_STORE_SCHEMA = `
CREATE TABLE IF NOT EXISTS eadwyn_documents (
  name TEXT PRIMARY KEY,
  revision TEXT NOT NULL,
  chunks INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS eadwyn_document_chunks (
  name TEXT NOT NULL,
  idx INTEGER NOT NULL,
  revision TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (name, idx)
);
`;

export interface D1StoreOptions<T> extends StoreCodec<T> {
  db: D1DatabaseLike;
  /** Document name (primary key). */
  name: string;
  /** Chunk size in UTF-16 code units; small enough to stay far inside D1's statement limits. */
  chunkSize?: number;
}

interface ChunkRow {
  revision: string;
  chunks: number;
  idx: number;
  body: string;
}

export function createD1Store<T>(options: D1StoreOptions<T>): JsonStore<T> {
  const { db, name, chunkSize = 30_000 } = options;

  return createStoreFromBackend(
    {
      location: `d1:${name}`,
      cacheable: false,
      async load() {
        const { results } = await db
          .prepare(
            `SELECT d.revision AS revision, d.chunks AS chunks, c.idx AS idx, c.body AS body
               FROM eadwyn_documents d
               JOIN eadwyn_document_chunks c ON c.name = d.name AND c.revision = d.revision
              WHERE d.name = ?
              ORDER BY c.idx`,
          )
          .bind(name)
          .all<ChunkRow>();
        if (results.length === 0) {
          return null;
        }
        const first = results[0] as ChunkRow;
        if (results.length !== first.chunks) {
          throw new Error(`d1:${name}: stored document is incomplete`);
        }
        return { json: results.map((row) => row.body).join(""), revision: first.revision };
      },
      async save(json, expected) {
        const revision = newRevision();
        const chunks = chunkString(json, chunkSize);
        const now = new Date().toISOString();
        const ours = "EXISTS (SELECT 1 FROM eadwyn_documents WHERE name = ? AND revision = ?)";
        const statements = [
          expected === null
            ? db
                .prepare(
                  "INSERT INTO eadwyn_documents (name, revision, chunks, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO NOTHING",
                )
                .bind(name, revision, chunks.length, now)
            : db
                .prepare(
                  "UPDATE eadwyn_documents SET revision = ?, chunks = ?, updated_at = ? WHERE name = ? AND revision = ?",
                )
                .bind(revision, chunks.length, now, name, expected),
          // Everything below only applies if the statement above won the race.
          db
            .prepare(
              `DELETE FROM eadwyn_document_chunks WHERE name = ? AND revision <> ? AND ${ours}`,
            )
            .bind(name, revision, name, revision),
          ...chunks.map((body, idx) =>
            db
              .prepare(
                `INSERT INTO eadwyn_document_chunks (name, idx, revision, body) SELECT ?, ?, ?, ? WHERE ${ours}`,
              )
              .bind(name, idx, revision, body, name, revision),
          ),
        ];
        const results = await db.batch(statements);
        return (results[0]?.meta.changes ?? 0) === 1 ? revision : null;
      },
    },
    options,
  );
}
