/**
 * Durable Object variant of the store.
 *
 * A Durable Object is a single-threaded owner of its storage, which is
 * exactly the guarantee the file store gets from "one process per data
 * directory". The document is written as JSON split across keys so it can
 * grow past the per-value limit; all chunks and the metadata key go in one
 * `put`, which the runtime commits atomically.
 */
import { chunkString, createStoreFromBackend } from "./core";
import type { JsonStore, StoreCodec } from "./types";

/** The subset of `DurableObjectStorage` this store needs. */
export interface DurableObjectStorageLike {
  get(keys: string[]): Promise<Map<string, unknown>>;
  put(entries: Record<string, unknown>): Promise<void>;
  delete(keys: string[]): Promise<number>;
}

export interface DurableObjectStoreOptions<T> extends StoreCodec<T> {
  storage: DurableObjectStorageLike;
  /** Key prefix, so one object can hold several documents. */
  key?: string;
  /** Chunk size in UTF-16 code units. Values are capped at 2 MB; 500k chars stays well under. */
  chunkSize?: number;
}

interface ChunkMeta {
  chunks: number;
  revision: string;
}

// The storage API accepts at most 128 keys per call; one is the metadata key.
const MAX_CHUNKS = 127;

export function createDurableObjectStore<T>(options: DurableObjectStoreOptions<T>): JsonStore<T> {
  const { storage, key = "document", chunkSize = 500_000 } = options;
  const metaKey = `${key}:meta`;
  const chunkKey = (index: number) => `${key}:chunk:${index}`;

  return createStoreFromBackend(
    {
      location: `durable-object:${key}`,
      cacheable: true,
      async load() {
        const metaMap = await storage.get([metaKey]);
        const meta = metaMap.get(metaKey) as ChunkMeta | undefined;
        if (!meta) {
          return null;
        }
        const keys = Array.from({ length: meta.chunks }, (_, i) => chunkKey(i));
        const values = await storage.get(keys);
        const parts = keys.map((k) => values.get(k));
        if (parts.some((part) => typeof part !== "string")) {
          throw new Error(`${key}: stored document is incomplete (${meta.chunks} chunks expected)`);
        }
        return { json: parts.join(""), revision: meta.revision };
      },
      async save(json, expected) {
        const chunks = chunkString(json, chunkSize);
        if (chunks.length > MAX_CHUNKS) {
          throw new Error(
            `${key}: document is ${json.length} chars; the Durable Object store holds at most ${MAX_CHUNKS} chunks`,
          );
        }
        const previous = (await storage.get([metaKey])).get(metaKey) as ChunkMeta | undefined;
        if ((previous?.revision ?? null) !== expected) {
          return null;
        }
        const revision = crypto.randomUUID();
        const entries: Record<string, unknown> = {
          [metaKey]: { chunks: chunks.length, revision } satisfies ChunkMeta,
        };
        chunks.forEach((chunk, index) => {
          entries[chunkKey(index)] = chunk;
        });
        await storage.put(entries);
        const stale = Array.from(
          { length: Math.max(0, (previous?.chunks ?? 0) - chunks.length) },
          (_, i) => chunkKey(chunks.length + i),
        );
        if (stale.length > 0) {
          await storage.delete(stale);
        }
        return revision;
      },
    },
    options,
  );
}

/** Whether a document has ever been written under `key`, without seeding one. */
export async function durableObjectDocumentExists(
  storage: DurableObjectStorageLike,
  key = "document",
): Promise<boolean> {
  return (await storage.get([`${key}:meta`])).has(`${key}:meta`);
}
