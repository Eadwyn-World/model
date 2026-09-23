/**
 * Where the weight math runs.
 *
 *  - inline: in this process (Node) or this Worker/Workflow step. Fine for
 *    small adapters; bounded by INLINE_AGGREGATION_MAX_BYTES because a Worker
 *    has 128 MB of memory.
 *  - container: a Cloudflare Container running apps/merge-runner.
 *  - http: any merge runner reachable over HTTP, e.g. on a Pod GPU.
 *  - auto: inline when the inputs fit, otherwise the offload backend.
 */
import type { ObjectStore } from "@eadwyn/service-kit";
import {
  type AggregationJobRequest,
  type AggregationJobResult,
  AggregationJobResultSchema,
} from "@eadwyn/shared-protocol";
import { objectStoreIO, runAggregationJob } from "@eadwyn/weights";
import type { AggregationBackend } from "./ports";

export function createInlineBackend(store: ObjectStore): AggregationBackend {
  return {
    name: "inline",
    aggregate: (job) => runAggregationJob(objectStoreIO(store), job, { backend: "inline" }),
  };
}

/** Talks to a merge runner's `POST /v1/jobs` through any fetch (a URL, a Container, a service binding). */
export function createRemoteBackend(options: {
  name: string;
  fetch: (request: Request) => Promise<Response>;
  baseUrl: string;
  token?: string;
}): AggregationBackend {
  return {
    name: options.name,
    async aggregate(job: AggregationJobRequest): Promise<AggregationJobResult> {
      const response = await options.fetch(
        new Request(new URL("/v1/jobs", options.baseUrl), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
          },
          body: JSON.stringify(job),
        }),
      );
      const body = (await response.json().catch(() => ({}))) as unknown;
      if (!response.ok) {
        const error = (body as { error?: { code?: string; message?: string } }).error;
        throw Object.assign(
          new Error(`${options.name} merge runner: ${error?.message ?? `HTTP ${response.status}`}`),
          {
            // Bad inputs will fail the same way on every retry.
            retryable: response.status >= 500 || response.status === 429,
          },
        );
      }
      return AggregationJobResultSchema.parse(body);
    },
  };
}

export function createAutoBackend(options: {
  inline: AggregationBackend;
  offload?: AggregationBackend;
  inlineMaxBytes: number;
}): AggregationBackend {
  return {
    name: "auto",
    aggregate(job, context) {
      if (context.inputBytes <= options.inlineMaxBytes || !options.offload) {
        if (context.inputBytes > options.inlineMaxBytes) {
          throw Object.assign(
            new Error(
              `inputs are ${context.inputBytes} bytes, above the inline limit of ${options.inlineMaxBytes}; configure a Container or MERGE_RUNNER_URL`,
            ),
            { retryable: false },
          );
        }
        return options.inline.aggregate(job, context);
      }
      return options.offload.aggregate(job, context);
    },
  };
}
