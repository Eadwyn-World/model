import { applyD1Migrations, env, runInDurableObject } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { createD1Store } from "../../src/stores/d1";
import { createDurableObjectStore } from "../../src/stores/durable-object";
import type { ProbeDoc } from "../worker";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

describe("Durable Object store (workerd)", () => {
  it("serialises concurrent updates inside one object", async () => {
    const stub = env.PROBE.get(env.PROBE.idFromName("concurrency"));
    const results = await Promise.all(Array.from({ length: 20 }, () => stub.bump(1)));
    expect(results.sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect((await stub.read()).count).toBe(20);
  });

  it("splits large documents across keys and cleans up when they shrink", async () => {
    const stub = env.PROBE.get(env.PROBE.idFromName("chunks"));
    await stub.setBlob(4_500);
    const grown = await stub.storedKeys();
    expect(grown.filter((k) => k.startsWith("probe:chunk:")).length).toBeGreaterThanOrEqual(5);

    await stub.setBlob(10);
    expect(await stub.storedKeys()).toEqual(["probe:chunk:0", "probe:meta"]);
    expect((await stub.read()).blob).toBe("x".repeat(10));
  });

  it("persists to storage, not only to the instance cache", async () => {
    const stub = env.PROBE.get(env.PROBE.idFromName("persist"));
    await stub.bump(7);
    const fromStorage = await runInDurableObject(stub, (_instance, state) =>
      createDurableObjectStore<ProbeDoc>({
        storage: state.storage,
        key: "probe",
        seed: () => ({ count: -1, blob: "" }),
      }).read(),
    );
    expect(fromStorage.count).toBe(7);
  });
});

describe("D1 store (workerd)", () => {
  const seed = () => ({ count: 0, notes: [] as string[] });

  it("round-trips a multi-chunk document and shrinks it cleanly", async () => {
    const store = createD1Store({ db: env.DB, name: "roundtrip", seed, chunkSize: 1_000 });
    await store.update((state) => {
      state.notes.push("y".repeat(3_500));
    });
    const chunks = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM eadwyn_document_chunks WHERE name = ?",
    )
      .bind("roundtrip")
      .first<{ n: number }>();
    expect(chunks?.n).toBeGreaterThanOrEqual(4);

    await store.update((state) => {
      state.notes = ["short"];
    });
    const after = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM eadwyn_document_chunks WHERE name = ?",
    )
      .bind("roundtrip")
      .first<{ n: number }>();
    expect(after?.n).toBe(1);
    expect(await store.read()).toEqual({ count: 0, notes: ["short"] });
  });

  it("detects a concurrent writer and re-runs the mutation on fresh state", async () => {
    // Two store instances on one row behave like two isolates racing.
    const a = createD1Store({ db: env.DB, name: "race", seed });
    const b = createD1Store({ db: env.DB, name: "race", seed });
    await a.read();

    let attempts = 0;
    const result = await a.update(async (state) => {
      attempts += 1;
      if (attempts === 1) {
        await b.update((other) => {
          other.count += 10;
        });
      }
      state.count += 1;
      return state.count;
    });

    expect(attempts).toBe(2);
    expect(result).toBe(11);
    expect((await b.read()).count).toBe(11);
  });
});
