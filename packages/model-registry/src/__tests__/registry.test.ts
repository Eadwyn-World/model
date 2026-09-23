import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createModelRegistry, ModelRegistryError } from "../registry";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "eadwyn-registry-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const checkpoint = {
  uri: "eadwyn://checkpoints/next/model.safetensors",
  sha256: "f".repeat(64),
  bytes: 249_561_088,
};

describe("model registry", () => {
  it("seeds a history and exposes the current version", async () => {
    const registry = createModelRegistry({ filePath: join(dir, "registry.json") });
    const current = await registry.getCurrent();
    expect(current.version).toBe("0.3.1");
    const versions = await registry.listVersions();
    expect(versions.map((v) => v.version)).toEqual(["0.3.1", "0.3.0", "0.2.0", "0.1.0"]);
  });

  it("publishes a minor bump on top of the current version and persists it", async () => {
    const filePath = join(dir, "registry.json");
    const registry = createModelRegistry({ filePath });
    const published = await registry.publish({
      parentVersion: "0.3.1",
      checkpoint,
      changelog: "Round 41 merge",
      mergeCandidateId: "a1b2c3d4-0004-4000-8000-000000000041",
    });
    expect(published.version).toBe("0.4.0");
    expect(published.parentVersion).toBe("0.3.1");

    const reopened = createModelRegistry({ filePath });
    expect((await reopened.getCurrent()).version).toBe("0.4.0");
  });

  it("refuses to publish on a stale parent", async () => {
    const registry = createModelRegistry({ filePath: join(dir, "registry.json") });
    await expect(
      registry.publish({ parentVersion: "0.2.0", checkpoint, changelog: "stale" }),
    ).rejects.toBeInstanceOf(ModelRegistryError);
  });
});
