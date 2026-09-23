import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileStore } from "../node/file-store";
import { chunkString } from "../stores/core";
import { createMemoryStore } from "../stores/memory";
import type { JsonStore } from "../stores/types";

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

const seed = (): Counter => ({ count: 0, log: [] });

const backends: [string, () => JsonStore<Counter>][] = [
  ["file", () => createFileStore<Counter>({ filePath: join(dir, "nested", "state.json"), seed })],
  ["memory", () => createMemoryStore<Counter>({ seed })],
];

describe.each(backends)("%s store", (_name, make) => {
  it("seeds, persists updates and returns isolated snapshots", async () => {
    const store = make();
    expect(await store.read()).toEqual({ count: 0, log: [] });
    await store.update((state) => {
      state.count += 1;
      state.log.push("first");
    });
    const snapshot = await store.read();
    expect(snapshot).toEqual({ count: 1, log: ["first"] });
    snapshot.count = 99;
    expect((await store.read()).count).toBe(1);
  });

  it("serialises concurrent updates", async () => {
    const store = make();
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

  it("leaves the stored state untouched when a mutation throws", async () => {
    const store = make();
    await store.update((state) => {
      state.count = 5;
    });
    await expect(
      store.update((state) => {
        state.count = 6;
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect((await store.read()).count).toBe(5);
  });
});

describe("file store", () => {
  it("writes readable JSON atomically", async () => {
    const filePath = join(dir, "state.json");
    const store = createFileStore<Counter>({ filePath, seed });
    await store.update((state) => {
      state.log.push("x");
    });
    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual({ count: 0, log: ["x"] });
    expect(store.location).toBe(`file:${filePath}`);
  });
});

describe("chunkString", () => {
  it("splits without breaking surrogate pairs and round-trips", () => {
    const value = `${"a".repeat(9)}😀${"b".repeat(10)}`;
    const chunks = chunkString(value, 10);
    expect(chunks.join("")).toBe(value);
    expect(chunks.every((chunk) => chunk.length <= 10)).toBe(true);
    expect(chunks[0]).toBe("a".repeat(9));
  });
});
