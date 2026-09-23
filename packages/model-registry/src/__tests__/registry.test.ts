import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryStore } from "@eadwyn/service-kit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileModelRegistry } from "../node";
import { createModelRegistry, ModelRegistryError, registryCodec } from "../registry";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "eadwyn-registry-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const checkpoint = {
  uri: "store://checkpoints/rounds/r/candidates/c.safetensors",
  sha256: "f".repeat(64),
  bytes: 8_192,
};

describe("model registry", () => {
  it("seeds a history and exposes the current version", async () => {
    const registry = createFileModelRegistry({ filePath: join(dir, "registry.json") });
    expect((await registry.getCurrent()).version).toBe("0.3.1");
    const versions = await registry.listVersions();
    expect(versions.map((v) => v.version)).toEqual(["0.3.1", "0.3.0", "0.2.0", "0.1.0"]);
  });

  it("publishes a minor bump, persists it, and replays idempotently per candidate", async () => {
    const filePath = join(dir, "registry.json");
    const registry = createFileModelRegistry({ filePath });
    const input = {
      parentVersion: "0.3.1",
      checkpoint,
      changelog: "Round 41 merge",
      mergeCandidateId: "a1b2c3d4-0004-4000-8000-000000000041",
    };
    const first = await registry.publish(input);
    expect(first).toMatchObject({
      created: true,
      model: { version: "0.4.0", parentVersion: "0.3.1" },
    });

    // A retry after a lost response must not bump again, even though the parent is now stale.
    const replay = await registry.publish(input);
    expect(replay).toMatchObject({ created: false, model: { version: "0.4.0" } });
    expect((await registry.findByCandidate(input.mergeCandidateId))?.version).toBe("0.4.0");

    const reopened = createFileModelRegistry({ filePath });
    expect((await reopened.getCurrent()).version).toBe("0.4.0");
  });

  it("refuses to publish on a stale parent", async () => {
    const registry = createModelRegistry({ store: createMemoryStore(registryCodec()) });
    await expect(
      registry.publish({ parentVersion: "0.2.0", checkpoint, changelog: "stale" }),
    ).rejects.toBeInstanceOf(ModelRegistryError);
  });

  it("adopts newer versions published elsewhere and ignores older ones", async () => {
    const coordinator = createModelRegistry({ store: createMemoryStore(registryCodec()) });
    const edge = createModelRegistry({ store: createMemoryStore(registryCodec()) });
    const { model } = await coordinator.publish({
      parentVersion: "0.3.1",
      checkpoint,
      changelog: "merge",
    });

    await expect(edge.adopt(model)).resolves.toMatchObject({
      adopted: true,
      current: { version: "0.4.0" },
    });
    await expect(edge.adopt(model)).resolves.toMatchObject({ adopted: false });
    const old = await coordinator.getVersion("0.2.0");
    await expect(edge.adopt(old as NonNullable<typeof old>)).resolves.toMatchObject({
      adopted: false,
      current: { version: "0.4.0" },
    });
  });
});
