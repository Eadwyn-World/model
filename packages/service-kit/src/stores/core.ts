/**
 * Shared machinery behind every store backend: serialised mutations inside
 * one isolate/process, an optional in-memory cache for single-writer
 * backends, and a compare-and-swap retry loop for multi-writer ones.
 */
import { type JsonStore, type StoreCodec, StoreConflictError } from "./types";

export interface Loaded {
  json: string;
  /** Backend-specific revision marker used for compare-and-swap. */
  revision: string | null;
}

export interface StoreBackend {
  location: string;
  /**
   * Single-writer backends (one process owns the file, one Durable Object owns
   * its storage) can keep the parsed document in memory between operations.
   */
  cacheable: boolean;
  load(): Promise<Loaded | null>;
  /**
   * Persist `json`. `expected` is the revision that was loaded (null when the
   * document did not exist). Resolve with the new revision, or with `null`
   * when another writer changed the document in between; the store will then
   * reload and retry.
   */
  save(json: string, expected: string | null): Promise<string | null>;
}

const MAX_ATTEMPTS = 6;

export function createStoreFromBackend<T>(
  backend: StoreBackend,
  codec: StoreCodec<T>,
): JsonStore<T> {
  const parse = codec.parse ?? ((raw: unknown) => raw as T);
  let cached: { state: T; revision: string | null } | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  function serialize<R>(task: () => Promise<R>): Promise<R> {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  }

  async function load(): Promise<{ state: T; revision: string | null; fresh: boolean }> {
    if (backend.cacheable && cached) {
      return { ...cached, fresh: false };
    }
    const loaded = await backend.load();
    if (!loaded) {
      return { state: codec.seed(), revision: null, fresh: true };
    }
    const state = parse(JSON.parse(loaded.json));
    if (backend.cacheable) {
      cached = { state, revision: loaded.revision };
    }
    return { state, revision: loaded.revision, fresh: false };
  }

  async function persist(state: T, expected: string | null): Promise<boolean> {
    const revision = await backend.save(JSON.stringify(state), expected);
    if (revision === null) {
      return false;
    }
    if (backend.cacheable) {
      cached = { state, revision };
    }
    return true;
  }

  return {
    location: backend.location,

    read: () =>
      serialize(async () => {
        const { state, revision, fresh } = await load();
        if (fresh) {
          // Seed on first access so every backend starts from the same document.
          await persist(state, revision);
        }
        return structuredClone(state);
      }),

    update: (mutate) =>
      serialize(async () => {
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
          const { state, revision } = await load();
          // Work on a copy so a failed or conflicting write never leaks into the cache.
          const draft = structuredClone(state);
          const result = await mutate(draft);
          if (await persist(draft, revision)) {
            return result;
          }
          cached = undefined;
        }
        throw new StoreConflictError(backend.location, MAX_ATTEMPTS);
      }),

    reset: () =>
      serialize(async () => {
        const seeded = codec.seed();
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
          cached = undefined;
          const current = await backend.load();
          if (await persist(seeded, current?.revision ?? null)) {
            return structuredClone(seeded);
          }
        }
        throw new StoreConflictError(backend.location, MAX_ATTEMPTS);
      }),
  };
}

/** Splits a string into chunks of at most `size` UTF-16 code units, never splitting a surrogate pair. */
export function chunkString(value: string, size: number): string[] {
  if (value.length <= size) {
    return [value];
  }
  const chunks: string[] = [];
  let start = 0;
  while (start < value.length) {
    let end = Math.min(start + size, value.length);
    const code = value.charCodeAt(end - 1);
    if (end < value.length && code >= 0xd800 && code <= 0xdbff) {
      end -= 1;
    }
    chunks.push(value.slice(start, end));
    start = end;
  }
  return chunks;
}

export function newRevision(): string {
  return crypto.randomUUID();
}
