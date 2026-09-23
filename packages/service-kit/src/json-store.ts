/**
 * A tiny JSON-file store: the "mock persistence" every service uses today.
 *
 * Design goals:
 *  - deterministic local development: a missing file is seeded, never errors
 *  - atomic writes (temp file + rename) so a crash never leaves a torn file
 *  - serialised mutations so concurrent requests cannot interleave writes
 *  - an interface small enough to swap for SQLite/Postgres later without
 *    touching route code (see docs/architecture/overview.md, "Persistence")
 *
 * Not supported: multiple processes sharing one file. Run one instance per
 * data directory.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface JsonStoreOptions<T> {
  filePath: string;
  /** Produces the initial state when the file does not exist yet. */
  seed: () => T;
  /** Validates (and may upgrade) what was read from disk. Throw to refuse a corrupt file. */
  parse?: (raw: unknown) => T;
}

export interface JsonStore<T> {
  readonly filePath: string;
  /** A snapshot copy. Mutating it does nothing; use `update`. */
  read(): Promise<T>;
  /** Mutate the state in place; it is persisted after `mutate` resolves. */
  update<R>(mutate: (state: T) => R | Promise<R>): Promise<R>;
  /** Replace the state with a fresh seed. Mostly for tests and demos. */
  reset(): Promise<T>;
}

export function createJsonStore<T>(options: JsonStoreOptions<T>): JsonStore<T> {
  const { filePath, seed, parse = (raw) => raw as T } = options;
  let cache: T | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  async function load(): Promise<T> {
    if (cache !== undefined) {
      return cache;
    }
    try {
      const raw = await readFile(filePath, "utf8");
      cache = parse(JSON.parse(raw));
    } catch (error) {
      if (!isMissingFile(error)) {
        throw error;
      }
      cache = seed();
      await persist(cache);
    }
    return cache;
  }

  async function persist(state: T): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(tmp, filePath);
  }

  function serialize<R>(task: () => Promise<R>): Promise<R> {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  }

  return {
    filePath,
    read: () => serialize(async () => structuredClone(await load())),
    update: (mutate) =>
      serialize(async () => {
        const state = await load();
        const result = await mutate(state);
        await persist(state);
        return result;
      }),
    reset: () =>
      serialize(async () => {
        cache = seed();
        await persist(cache);
        return structuredClone(cache);
      }),
  };
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
