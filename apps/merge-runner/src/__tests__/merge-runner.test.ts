import { createLogger, createMemoryObjectStore } from "@eadwyn/service-kit";
import {
  canonicalJson,
  type MergeManifest,
  sha256Hex,
  storeUri,
  utf8Encode,
} from "@eadwyn/shared-protocol";
import { decodeSafetensors, encodeSafetensors } from "@eadwyn/weights";
import { describe, expect, it } from "vitest";
import { createMergeRunnerApp } from "../app";

const logger = createLogger({ service: "merge-runner-test", level: "error" });
const t = (values: number[]) => ({
  dtype: "F32" as const,
  shape: [values.length],
  data: Float32Array.from(values),
});

async function stage() {
  const store = createMemoryObjectStore();
  const put = async (bucket: "deltas" | "checkpoints", key: string, bytes: Uint8Array) => {
    const sha256 = await sha256Hex(bytes);
    await store.put(bucket, key, bytes, { sha256, bytes: bytes.byteLength });
    return { uri: storeUri(bucket, key), sha256, bytes: bytes.byteLength };
  };
  const a = await put("deltas", "a.safetensors", encodeSafetensors({ w: t([1, 1]) }));
  const b = await put("deltas", "b.safetensors", encodeSafetensors({ w: t([3, 5]) }));
  const manifest: MergeManifest = {
    schema: "eadwyn.merge-manifest/1",
    candidateId: "a1b2c3d4-0004-4000-8000-000000000001",
    roundId: "a1b2c3d4-0002-4000-8000-000000000001",
    baseModelVersion: "0.1.0",
    method: "fedavg",
    inputs: [
      {
        updateId: "a1b2c3d4-0003-4000-8000-000000000001",
        nodeId: "a1b2c3d4-0001-4000-8000-000000000001",
        delta: a,
        samples: 1,
        weight: 0.5,
      },
      {
        updateId: "a1b2c3d4-0003-4000-8000-000000000002",
        nodeId: "a1b2c3d4-0001-4000-8000-000000000002",
        delta: b,
        samples: 1,
        weight: 0.5,
      },
    ],
    createdAt: new Date().toISOString(),
  };
  const manifestRef = await put("checkpoints", "m.json", utf8Encode(canonicalJson(manifest)));
  return { store, manifestRef };
}

const post = (app: ReturnType<typeof createMergeRunnerApp>, body: unknown, token?: string) =>
  app.request("/v1/jobs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

describe("merge runner", () => {
  it("runs an aggregation job and writes the merged delta", async () => {
    const { store, manifestRef } = await stage();
    const app = createMergeRunnerApp({
      store,
      logger,
      token: "runner-token",
      runnerName: "container",
    });
    const job = {
      jobId: "j",
      manifest: manifestRef,
      outputUri: "store://checkpoints/merged.safetensors",
    };

    expect((await post(app, job)).status).toBe(401);
    const res = await post(app, job, "runner-token");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      inputs: 2,
      tensors: 1,
      backend: "container",
      method: "fedavg",
    });
    const merged = decodeSafetensors(
      (await store.get("checkpoints", "merged.safetensors")) as Uint8Array,
    );
    expect(Array.from(merged.tensors.w?.data ?? [])).toEqual([2, 3]);
  });

  it("answers 422 for inputs that will never aggregate", async () => {
    const { store, manifestRef } = await stage();
    const app = createMergeRunnerApp({ store, logger, runnerName: "http" });
    const res = await post(app, {
      jobId: "j",
      manifest: { ...manifestRef, sha256: "0".repeat(64) },
      outputUri: "store://checkpoints/x",
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: { code: "invalid_inputs" } });
  });
});
