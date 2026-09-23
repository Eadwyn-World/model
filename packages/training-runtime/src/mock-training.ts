/**
 * Mock local training.
 *
 * Produces plausible metrics and a real safetensors adapter delta (the seed
 * model's LoRA layout, see @eadwyn/weights) from a seed, so demos and tests
 * are reproducible and the aggregator does genuine arithmetic on them. Nothing
 * here learns; the function signature is the seam where a real trainer
 * (PyTorch, llama.cpp, MLX, ...) plugs in later.
 */
import { mulberry32, sha256Hex, type TrainingMetrics } from "@eadwyn/shared-protocol";
import { encodeSafetensors, seedAdapterLayout, type TensorMap } from "@eadwyn/weights";

export interface SimulateTrainingInput {
  seed: number;
  samples: number;
  steps: number;
  /** Loss of the base model on this node's data before training. */
  baseLoss?: number;
}

export interface SimulatedTraining {
  metrics: TrainingMetrics;
  /** safetensors bytes of the adapter delta. */
  delta: Uint8Array;
  sha256: string;
}

export async function simulateLocalTraining(
  input: SimulateTrainingInput,
): Promise<SimulatedTraining> {
  const random = mulberry32(input.seed);
  const lossBefore = input.baseLoss ?? 2.2 + random() * 0.5;
  // Diminishing returns: more steps help, but never below a floor.
  const improvement = Math.min(0.6, 0.08 * Math.log1p(input.steps / 25)) * (0.8 + random() * 0.4);
  const lossAfter = Math.max(0.9, lossBefore - improvement);
  const wallClockSeconds = Math.round(input.steps * (1.2 + random() * 1.5) * 10) / 10;

  // Seeded gaussian values, scaled by how much this node learned.
  const gaussian = () => {
    const u = Math.max(random(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
  };
  const tensors: TensorMap = {};
  for (const [name, shape] of Object.entries(seedAdapterLayout())) {
    const data = new Float32Array(shape.reduce((n, d) => n * d, 1));
    for (let i = 0; i < data.length; i += 1) data[i] = gaussian() * 0.02 * (1 + improvement);
    tensors[name] = { dtype: "F32", shape, data };
  }
  const delta = encodeSafetensors(tensors, {
    format: "eadwyn.adapter-delta/1",
    samples: String(input.samples),
  });

  return {
    metrics: {
      samples: input.samples,
      steps: input.steps,
      lossBefore: round3(lossBefore),
      lossAfter: round3(lossAfter),
      wallClockSeconds,
    },
    delta,
    sha256: await sha256Hex(delta),
  };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
