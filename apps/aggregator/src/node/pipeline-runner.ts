/**
 * In-process pipeline runner (Node): the same steps a Cloudflare Workflow
 * runs, executed in the background with simple per-step retries. Progress
 * lives in the repository, so `GET /v1/merges/:id` shows it either way.
 */
import type { Logger } from "@eadwyn/service-kit";
import type { MergePipelineRunner, StepRunner } from "../ports";

export function createInProcessStepRunner(options: { baseDelayMs?: number } = {}): StepRunner {
  const baseDelay = options.baseDelayMs ?? 500;
  return {
    async do(_name, task, stepOptions) {
      const attempts = 1 + (stepOptions?.retries ?? 2);
      let lastError: unknown;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          return await task();
        } catch (error) {
          lastError = error;
          if ((error as { retryable?: boolean }).retryable === false || attempt === attempts) break;
          await new Promise((resolve) => setTimeout(resolve, baseDelay * 2 ** (attempt - 1)));
        }
      }
      throw lastError;
    },
  };
}

export function createInProcessPipeline(options: {
  run: (candidateId: string, step: StepRunner) => Promise<unknown>;
  logger: Logger;
  step?: StepRunner;
}): MergePipelineRunner & { idle(): Promise<void> } {
  const inflight = new Set<Promise<unknown>>();
  const step = options.step ?? createInProcessStepRunner();
  return {
    async start(candidateId) {
      const run = options
        .run(candidateId, step)
        .catch((error) => options.logger.warn("merge pipeline failed", { candidateId, error }))
        .finally(() => inflight.delete(run));
      inflight.add(run);
    },
    async idle() {
      await Promise.all([...inflight]);
    },
  };
}
