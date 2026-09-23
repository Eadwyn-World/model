/**
 * Merge runner HTTP surface: one job endpoint. It reads the manifest and the
 * deltas it names from object storage, verifies every digest, aggregates,
 * writes the merged delta back and reports what it produced.
 */
import {
  bearerToken,
  createServiceApp,
  HttpError,
  type Logger,
  type ObjectStore,
  safeEqual,
  validateJson,
} from "@eadwyn/service-kit";
import { AggregationJobRequestSchema } from "@eadwyn/shared-protocol";
import { AggregationInputError, objectStoreIO, runAggregationJob } from "@eadwyn/weights";
import type { Hono } from "hono";

export interface MergeRunnerDeps {
  store: ObjectStore;
  logger: Logger;
  token?: string;
  runnerName: string;
}

export function createMergeRunnerApp(deps: MergeRunnerDeps): Hono {
  const app = createServiceApp({
    name: "merge-runner",
    version: "0.1.0",
    description: "Executes aggregation jobs for the federation.",
    logger: deps.logger,
    healthDetails: () => ({ objectStore: deps.store.kind, runner: deps.runnerName }),
  });

  app.post("/v1/jobs", validateJson(AggregationJobRequestSchema), async (c) => {
    if (deps.token) {
      const presented = bearerToken(c);
      if (!presented || !safeEqual(presented, deps.token)) {
        throw new HttpError(401, "runner_auth_required", "a valid runner token is required");
      }
    }
    const job = c.req.valid("json");
    try {
      const result = await runAggregationJob(objectStoreIO(deps.store), job, {
        backend: deps.runnerName,
      });
      deps.logger.info("aggregation job finished", {
        jobId: job.jobId,
        inputs: result.inputs,
        tensors: result.tensors,
        durationMs: result.durationMs,
      });
      return c.json(result);
    } catch (error) {
      if (error instanceof AggregationInputError) {
        // Bad inputs fail the same way every time: tell the caller not to retry.
        throw new HttpError(422, "invalid_inputs", error.message);
      }
      throw error;
    }
  });

  return app;
}
