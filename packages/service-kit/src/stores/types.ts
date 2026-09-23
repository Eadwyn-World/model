/**
 * The three-method document store every Eadwyn service persists through.
 *
 * One interface, several backends: a JSON file (Node), a Durable Object's
 * storage (Cloudflare), a D1 table (Cloudflare) and memory (tests). Route and
 * domain code only ever sees this interface, so moving a service between
 * runtimes never touches its business logic.
 */
export interface JsonStore<T> {
  /** Human-readable description of where the document lives, e.g. `file:./data/x.json`. */
  readonly location: string;
  /** A snapshot copy. Mutating it does nothing; use `update`. */
  read(): Promise<T>;
  /**
   * Mutate the state in place; it is persisted after `mutate` resolves.
   * Backends with optimistic concurrency (D1) may run `mutate` more than once
   * when another writer wins a race, so `mutate` must not have side effects
   * beyond the state it is given.
   */
  update<R>(mutate: (state: T) => R | Promise<R>): Promise<R>;
  /** Replace the state with a fresh seed. Mostly for tests and demos. */
  reset(): Promise<T>;
}

export interface StoreCodec<T> {
  /** Produces the initial state when nothing is stored yet. */
  seed: () => T;
  /** Validates (and may upgrade) what was read back. Throw to refuse a corrupt document. */
  parse?: (raw: unknown) => T;
}

export class StoreConflictError extends Error {
  constructor(location: string, attempts: number) {
    super(`${location}: gave up after ${attempts} conflicting concurrent writes`);
    this.name = "StoreConflictError";
  }
}
