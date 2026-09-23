/**
 * Federated aggregation over float32 tensors.
 *
 *  - fedavg: weighted mean, weights ∝ the samples each node trained on
 *  - median: coordinate-wise median, robust to a minority of bad updates
 *  - trimmed-mean: coordinate-wise mean after dropping the top and bottom 10%
 *
 * Every input must have exactly the same tensors and shapes; anything else is
 * refused rather than guessed at.
 */
import type { AggregationMethod } from "@eadwyn/shared-protocol";
import type { Tensor, TensorMap } from "./safetensors";

export interface WeightedDelta {
  tensors: TensorMap;
  weight: number;
}

export class IncompatibleDeltasError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncompatibleDeltasError";
  }
}

function assertCompatible(inputs: WeightedDelta[]): string[] {
  const first = inputs[0];
  if (!first) throw new IncompatibleDeltasError("nothing to aggregate");
  const names = Object.keys(first.tensors).sort();
  inputs.forEach((input, index) => {
    const other = Object.keys(input.tensors).sort();
    if (other.length !== names.length || other.some((n, i) => n !== names[i])) {
      throw new IncompatibleDeltasError(`delta ${index} has a different set of tensors`);
    }
    for (const name of names) {
      const a = (first.tensors[name] as Tensor).shape;
      const b = (input.tensors[name] as Tensor).shape;
      if (a.length !== b.length || a.some((d, i) => d !== b[i])) {
        throw new IncompatibleDeltasError(
          `delta ${index}: ${name} has shape [${b}], expected [${a}]`,
        );
      }
    }
  });
  return names;
}

export function aggregateDeltas(inputs: WeightedDelta[], method: AggregationMethod): TensorMap {
  const names = assertCompatible(inputs);
  const totalWeight = inputs.reduce((sum, input) => sum + Math.max(0, input.weight), 0);
  const weights = inputs.map((input) =>
    totalWeight > 0 ? Math.max(0, input.weight) / totalWeight : 1 / inputs.length,
  );
  const out: TensorMap = {};
  const column = new Float64Array(inputs.length);

  for (const name of names) {
    const template = (inputs[0] as WeightedDelta).tensors[name] as Tensor;
    const size = template.data.length;
    const result = new Float32Array(size);
    if (method === "fedavg") {
      inputs.forEach((input, k) => {
        const data = (input.tensors[name] as Tensor).data;
        const w = weights[k] as number;
        for (let i = 0; i < size; i += 1)
          result[i] = (result[i] as number) + w * (data[i] as number);
      });
    } else {
      const trim = method === "trimmed-mean" ? Math.floor(inputs.length * 0.1) : 0;
      for (let i = 0; i < size; i += 1) {
        for (let k = 0; k < inputs.length; k += 1) {
          column[k] = ((inputs[k] as WeightedDelta).tensors[name] as Tensor).data[i] as number;
        }
        const sorted = column.slice().sort();
        if (method === "median") {
          const mid = sorted.length >> 1;
          result[i] =
            sorted.length % 2 === 0
              ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
              : (sorted[mid] as number);
        } else {
          const kept = sorted.subarray(trim, sorted.length - trim);
          let sum = 0;
          for (const v of kept) sum += v;
          result[i] = sum / kept.length;
        }
      }
    }
    out[name] = { dtype: "F32", shape: [...template.shape], data: result };
  }
  return out;
}

/** L2 norm across every tensor: a cheap summary reviewers can compare between candidates. */
export function l2Norm(tensors: TensorMap): number {
  let sum = 0;
  for (const tensor of Object.values(tensors)) {
    for (const v of tensor.data) sum += v * v;
  }
  return Math.sqrt(sum);
}
