import {
  type ArtifactRef,
  canonicalJson,
  type MergeManifest,
  sha256Hex,
  utf8Encode,
} from "@eadwyn/shared-protocol";
import { describe, expect, it } from "vitest";
import { seedAdapterLayout } from "../adapter";
import { aggregateDeltas, IncompatibleDeltasError } from "../aggregate";
import { AggregationInputError, runAggregationJob } from "../job";
import {
  decodeSafetensors,
  encodeSafetensors,
  SafetensorsError,
  type TensorMap,
} from "../safetensors";

const t = (shape: number[], values: number[]) => ({
  dtype: "F32" as const,
  shape,
  data: Float32Array.from(values),
});

describe("safetensors", () => {
  it("round-trips tensors and metadata with an 8-byte aligned data section", () => {
    const tensors: TensorMap = {
      "b.weight": t([2], [1.5, -2]),
      "a.weight": t([2, 2], [1, 2, 3, 4]),
    };
    const bytes = encodeSafetensors(tensors, { round: "41" });
    const headerLength = Number(new DataView(bytes.buffer).getBigUint64(0, true));
    expect((8 + headerLength) % 8).toBe(0);
    const decoded = decodeSafetensors(bytes);
    expect(decoded.metadata).toEqual({ round: "41" });
    expect(Array.from(decoded.tensors["a.weight"]?.data ?? [])).toEqual([1, 2, 3, 4]);
    expect(Array.from(decoded.tensors["b.weight"]?.data ?? [])).toEqual([1.5, -2]);
  });

  it("refuses malformed files", () => {
    const good = encodeSafetensors({ w: t([2], [1, 2]) });
    expect(() => decodeSafetensors(good.slice(0, 5))).toThrow(SafetensorsError);
    expect(() => decodeSafetensors(good.slice(0, good.length - 1))).toThrow(SafetensorsError);
    const trailing = new Uint8Array(good.length + 4);
    trailing.set(good);
    expect(() => decodeSafetensors(trailing)).toThrow(/unindexed/);
    const huge = good.slice();
    new DataView(huge.buffer).setBigUint64(0, 10n ** 12n, true);
    expect(() => decodeSafetensors(huge)).toThrow(/header length/);
  });
});

describe("aggregation", () => {
  const a = { w: t([3], [0, 0, 0]) };
  const b = { w: t([3], [3, 6, 9]) };
  const c = { w: t([3], [100, 100, 100]) };

  it("weights FedAvg by samples", () => {
    const merged = aggregateDeltas(
      [
        { tensors: a, weight: 2 },
        { tensors: b, weight: 1 },
      ],
      "fedavg",
    );
    expect(Array.from(merged.w?.data ?? [])).toEqual([1, 2, 3]);
  });

  it("resists an outlier with median and trimmed mean", () => {
    const inputs = [a, b, c].map((tensors) => ({ tensors, weight: 1 }));
    expect(Array.from(aggregateDeltas(inputs, "median").w?.data ?? [])).toEqual([3, 6, 9]);
    const ten = Array.from({ length: 10 }, (_, i) => ({
      tensors: { w: t([1], [i === 9 ? 1000 : i]) },
      weight: 1,
    }));
    // trims one value from each end: mean of 1..8
    expect(aggregateDeltas(ten, "trimmed-mean").w?.data[0]).toBeCloseTo(4.5);
  });

  it("refuses incompatible deltas", () => {
    expect(() =>
      aggregateDeltas(
        [
          { tensors: a, weight: 1 },
          { tensors: { w: t([2], [1, 2]) }, weight: 1 },
        ],
        "fedavg",
      ),
    ).toThrow(IncompatibleDeltasError);
  });

  it("describes the seed adapter", () => {
    const layout = seedAdapterLayout();
    expect(Object.keys(layout)).toHaveLength(16);
    expect(layout["blocks.0.attn.q_proj.lora_A"]).toEqual([8, 64]);
  });
});

describe("aggregation job", () => {
  async function fixture(tamper = false) {
    const objects = new Map<string, Uint8Array>();
    const put = async (uri: string, bytes: Uint8Array): Promise<ArtifactRef> => {
      objects.set(uri, bytes);
      return { uri, sha256: await sha256Hex(bytes), bytes: bytes.byteLength };
    };
    const d1 = await put("store://deltas/1", encodeSafetensors({ w: t([2], [2, 4]) }));
    const d2 = await put("store://deltas/2", encodeSafetensors({ w: t([2], [4, 8]) }));
    const manifest: MergeManifest = {
      schema: "eadwyn.merge-manifest/1",
      candidateId: "a1b2c3d4-0004-4000-8000-000000000001",
      roundId: "a1b2c3d4-0002-4000-8000-000000000041",
      baseModelVersion: "0.3.1",
      method: "fedavg",
      inputs: [
        {
          updateId: "a1b2c3d4-0003-4000-8000-000000000001",
          nodeId: "a1b2c3d4-0001-4000-8000-000000000001",
          delta: d1,
          samples: 300,
          weight: 0.75,
        },
        {
          updateId: "a1b2c3d4-0003-4000-8000-000000000002",
          nodeId: "a1b2c3d4-0001-4000-8000-000000000002",
          delta: d2,
          samples: 100,
          weight: 0.25,
        },
      ],
      createdAt: "2026-09-23T12:00:00.000Z",
    };
    const manifestRef = await put(
      "store://checkpoints/m.json",
      utf8Encode(canonicalJson(manifest)),
    );
    if (tamper) objects.set("store://deltas/2", encodeSafetensors({ w: t([2], [400, 800]) }));
    const io = {
      read: async (uri: string) => objects.get(uri) ?? null,
      write: async (uri: string, bytes: Uint8Array) => put(uri, bytes),
    };
    return { io, manifestRef, objects };
  }

  it("verifies inputs, aggregates and writes a merged adapter", async () => {
    const { io, manifestRef, objects } = await fixture();
    const result = await runAggregationJob(io, {
      jobId: "j1",
      manifest: manifestRef,
      outputUri: "store://checkpoints/out.safetensors",
    });
    expect(result).toMatchObject({ inputs: 2, tensors: 1, method: "fedavg", backend: "inline" });
    const merged = decodeSafetensors(
      objects.get("store://checkpoints/out.safetensors") as Uint8Array,
    );
    expect(Array.from(merged.tensors.w?.data ?? [])).toEqual([2.5, 5]);
    expect(merged.metadata.manifestSha256).toBe(manifestRef.sha256);
    expect(result.artifact.sha256).toBe(
      await sha256Hex(objects.get("store://checkpoints/out.safetensors") as Uint8Array),
    );
  });

  it("refuses a delta whose bytes changed after it was recorded", async () => {
    const { io, manifestRef } = await fixture(true);
    await expect(
      runAggregationJob(io, {
        jobId: "j2",
        manifest: manifestRef,
        outputUri: "store://checkpoints/out2",
      }),
    ).rejects.toBeInstanceOf(AggregationInputError);
  });
});
