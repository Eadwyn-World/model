import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256Hex } from "@eadwyn/shared-protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileObjectStore } from "../node/file-object-store";
import { createMemoryObjectStore } from "../objects/memory";
import { createS3Presigner } from "../objects/s3-presign";
import { ObjectIntegrityError, type ObjectStore } from "../objects/types";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "eadwyn-objects-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const stores: [string, () => ObjectStore][] = [
  ["filesystem", () => createFileObjectStore(dir)],
  ["memory", () => createMemoryObjectStore()],
];

const streamOf = (bytes: Uint8Array) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.subarray(0, 3));
      controller.enqueue(bytes.subarray(3));
      controller.close();
    },
  });

describe.each(stores)("%s object store", (_name, make) => {
  it("stores verified bytes from arrays and streams", async () => {
    const store = make();
    const bytes = new TextEncoder().encode("learning travels");
    const expected = { sha256: await sha256Hex(bytes), bytes: bytes.byteLength };

    await store.put("deltas", "rounds/r/updates/a.safetensors", bytes, expected);
    await store.put("deltas", "rounds/r/updates/b.safetensors", streamOf(bytes), expected);

    expect(await store.head("deltas", "rounds/r/updates/b.safetensors")).toEqual({
      bucket: "deltas",
      key: "rounds/r/updates/b.safetensors",
      bytes: bytes.byteLength,
      sha256: expected.sha256,
    });
    expect(
      new TextDecoder().decode(
        (await store.get("deltas", "rounds/r/updates/a.safetensors")) ?? undefined,
      ),
    ).toBe("learning travels");
    expect(await store.head("checkpoints", "missing")).toBeNull();
  });

  it("refuses bytes that do not match the declared digest", async () => {
    const store = make();
    const bytes = new TextEncoder().encode("tampered");
    await expect(
      store.put("deltas", "x", bytes, { sha256: "0".repeat(64), bytes: bytes.byteLength }),
    ).rejects.toBeInstanceOf(ObjectIntegrityError);
    expect(await store.head("deltas", "x")).toBeNull();
  });
});

describe("S3 presigner", () => {
  it("binds the URL to one key, an expiry and the expected checksum", async () => {
    const presigner = createS3Presigner({
      endpoint: "https://acct.r2.cloudflarestorage.com/",
      accessKeyId: "AKID",
      secretAccessKey: "secret",
      bucketNames: { deltas: "eadwyn-deltas", checkpoints: "eadwyn-checkpoints" },
      now: () => new Date("2026-09-23T12:00:00Z"),
    });
    const sha256 = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    const signed = await presigner.presignPut(
      "deltas",
      "rounds/r/updates/u.safetensors",
      { sha256, bytes: 3 },
      900,
    );
    const url = new URL(signed.url);
    expect(url.host).toBe("acct.r2.cloudflarestorage.com");
    expect(url.pathname).toBe("/eadwyn-deltas/rounds/r/updates/u.safetensors");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[a-f0-9]{64}$/);
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("x-amz-checksum-sha256");
    expect(signed.headers["x-amz-checksum-sha256"]).toBe(
      "ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=",
    );
    expect(signed.expiresAt).toBe("2026-09-23T12:15:00.000Z");
  });
});
