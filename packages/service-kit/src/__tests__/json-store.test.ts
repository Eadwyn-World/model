import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJsonStore } from "../json-store";

interface Counter {
  count: number;
  log: string[];
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "eadwyn-store-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("createJsonStore", () => {
  it("seeds a missing file and persists updates atomically", async () => {
    const filePath = join(dir, "nested", "state.json");
    const store = createJsonStore<Counter>({ filePath, seed: () => ({ count: 0, log: [] }) });

    expect(await store.read()).toEqual({ count: 0, log: [] });
    await store.update((state) => {
      state.count += 1;
      state.log.push("first");
    });

    const onDisk = JSON.parse(await readFile(filePath, "utf8")) as Counter;
    expect(onDisk).toEqual({ count: 1, log: ["first"] });
  });

  it("serialises concurrent updates", async () => {
    const store = createJsonStore<Counter>({
      filePath: join(dir, "state.json"),
      seed: () => ({ count: 0, log: [] }),
    });
    await Promise.all(
      Array.from({ length: 25 }, () =>
        store.update(async (state) => {
          const seen = state.count;
          await new Promise((resolve) => setTimeout(resolve, 1));
          state.count = seen + 1;
        }),
      ),
    );
    expect((await store.read()).count).toBe(25);
  });

  it("returns snapshots that cannot leak mutations", async () => {
    const store = createJsonStore<Counter>({
      filePath: join(dir, "state.json"),
      seed: () => ({ count: 0, log: [] }),
    });
    const snapshot = await store.read();
    snapshot.count = 99;
    expect((await store.read()).count).toBe(0);
  });
});
