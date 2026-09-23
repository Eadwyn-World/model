/**
 * Mock local training.
 *
 * Produces plausible metrics and a deterministic "delta" blob from a seed, so
 * demos and tests are reproducible. Nothing here is machine learning; the
 * function signature is the seam where a real trainer (PyTorch, llama.cpp,
 * MLX, ...) plugs in later.
 */
import { createHash } from "node:crypto";
import { mulberry32, type TrainingMetrics } from "@eadwyn/shared-protocol";

export interface SimulateTrainingInput {
  seed: number;
  samples: number;
  steps: number;
  /** Loss of the base model on this node's data before training. */
  baseLoss?: number;
}

export interface SimulatedTraining {
  metrics: TrainingMetrics;
  delta: Uint8Array;
  sha256: string;
}

export function simulateLocalTraining(input: SimulateTrainingInput): SimulatedTraining {
  const random = mulberry32(input.seed);
  const lossBefore = input.baseLoss ?? 2.2 + random() * 0.5;
  // Diminishing returns: more steps help, but never below a floor.
  const improvement = Math.min(0.6, 0.08 * Math.log1p(input.steps / 25)) * (0.8 + random() * 0.4);
  const lossAfter = Math.max(0.9, lossBefore - improvement);
  const wallClockSeconds = Math.round(input.steps * (1.2 + random() * 1.5) * 10) / 10;

  // A "delta" whose size scales with the work done; content is seeded noise.
  const bytes = Math.min(8 * 1024 * 1024, 64 * 1024 + input.samples * 96);
  const delta = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i += 1) {
    delta[i] = Math.floor(random() * 256);
  }
  const sha256 = createHash("sha256").update(delta).digest("hex");

  return {
    metrics: {
      samples: input.samples,
      steps: input.steps,
      lossBefore: round3(lossBefore),
      lossAfter: round3(lossAfter),
      wallClockSeconds,
    },
    delta,
    sha256,
  };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
