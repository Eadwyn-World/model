import { createStoreFromBackend } from "./core";
import type { JsonStore, StoreCodec } from "./types";

/** In-memory store: tests, previews, and anything that must not touch disk. */
export function createMemoryStore<T>(codec: StoreCodec<T>, name = "memory"): JsonStore<T> {
  let stored: { json: string; revision: string } | null = null;
  return createStoreFromBackend(
    {
      location: `memory:${name}`,
      cacheable: true,
      load: async () => stored,
      save: async (json, expected) => {
        if ((stored?.revision ?? null) !== expected) {
          return null;
        }
        stored = { json, revision: crypto.randomUUID() };
        return stored.revision;
      },
    },
    codec,
  );
}
