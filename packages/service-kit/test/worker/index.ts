import { DurableObject } from "cloudflare:workers";
import { createDurableObjectStore } from "../../src/stores/durable-object";

export interface ProbeDoc {
  count: number;
  blob: string;
}

/** Exposes a Durable Object-backed store over RPC so tests can drive it. */
export class StoreProbe extends DurableObject<Env> {
  private readonly store = createDurableObjectStore<ProbeDoc>({
    storage: this.ctx.storage,
    key: "probe",
    seed: () => ({ count: 0, blob: "" }),
    chunkSize: 1_000,
  });

  bump(by: number): Promise<number> {
    return this.store.update((state) => {
      state.count += by;
      return state.count;
    });
  }

  setBlob(length: number): Promise<void> {
    return this.store.update((state) => {
      state.blob = "x".repeat(length);
    });
  }

  read(): Promise<ProbeDoc> {
    return this.store.read();
  }

  async storedKeys(): Promise<string[]> {
    return [...(await this.ctx.storage.list()).keys()].sort();
  }
}

export default {
  fetch: () => new Response("service-kit store tests", { status: 404 }),
} satisfies ExportedHandler<Env>;
