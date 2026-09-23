/**
 * Mock inference. Produces an obviously-placeholder answer that still carries
 * the metadata a real runtime would: which model version answered, token
 * usage, and latency. The `mock: true` flag is part of the contract so no
 * client can mistake this for the model.
 */
import type { InferenceResponse, ModelVersion } from "@eadwyn/shared-protocol";

export function mockInfer(input: {
  prompt: string;
  maxTokens: number;
  model: ModelVersion;
  startedAt: number;
}): InferenceResponse {
  const { prompt, maxTokens, model, startedAt } = input;
  const excerpt = prompt.length > 80 ? `${prompt.slice(0, 77).trimEnd()}…` : prompt;
  const sentences = [
    `[mock · eadwyn ${model.version}] This edge is serving a placeholder answer for: "${excerpt}".`,
    "The federation is still training the shared model; nodes learn locally, learning travels as signed updates, and every merge is reviewed before it is published.",
    `The version answering you was published ${model.publishedAt} from merge ${model.mergeCandidateId ?? "genesis"}.`,
  ];
  const words = sentences.join(" ").split(/\s+/);
  const output = words.slice(0, Math.max(1, Math.min(maxTokens, words.length))).join(" ");
  return {
    modelVersion: model.version,
    output,
    usage: {
      promptTokens: countTokens(prompt),
      completionTokens: countTokens(output),
    },
    latencyMs: Math.max(1, Math.round(performance.now() - startedAt)),
    mock: true,
  };
}

/** Whitespace tokens: good enough for a mock, and honest about being one. */
function countTokens(text: string): number {
  return text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
}
