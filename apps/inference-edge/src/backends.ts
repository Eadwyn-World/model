/**
 * Who answers an inference request.
 *
 *  - workers-ai: a Workers AI base model, optionally with an Eadwyn LoRA
 *    adapter (≤ 300 MB, rank ≤ 32, on a LoRA-capable base). Runs on
 *    Cloudflare's GPUs; the Eadwyn weights never need a server of their own.
 *  - upstream: a Pod GPU serving the Eadwyn model (e.g. behind Cloudflare
 *    Tunnel + Access). The edge forwards, authenticates with an Access
 *    service token, and caches.
 *  - mock: a clearly-labelled placeholder, for development.
 *
 * Every response says which backend, runtime model and adapter produced it.
 */
import {
  type InferenceResponse,
  InferenceResponseSchema,
  type ModelVersion,
} from "@eadwyn/shared-protocol";

export type InferenceAnswer = Omit<InferenceResponse, "latencyMs" | "cached">;

export interface InferenceBackend {
  readonly name: InferenceResponse["backend"];
  /** Runtime model and adapter, for health and cache keys. */
  readonly model?: string;
  readonly adapter?: string;
  infer(input: {
    prompt: string;
    maxTokens: number;
    served: ModelVersion;
  }): Promise<InferenceAnswer>;
}

const countTokens = (text: string) => (text.trim() === "" ? 0 : text.trim().split(/\s+/).length);

export function createMockBackend(): InferenceBackend {
  return {
    name: "mock",
    async infer({ prompt, maxTokens, served }) {
      const excerpt = prompt.length > 80 ? `${prompt.slice(0, 77).trimEnd()}…` : prompt;
      const sentences = [
        `[mock · eadwyn ${served.version}] This edge is serving a placeholder answer for: "${excerpt}".`,
        "The federation is still training the shared model; nodes learn locally, learning travels as signed updates, and every merge is reviewed before it is published.",
        `The version answering you was published ${served.publishedAt} from merge ${served.mergeCandidateId ?? "genesis"}.`,
      ];
      const words = sentences.join(" ").split(/\s+/);
      const output = words.slice(0, Math.max(1, Math.min(maxTokens, words.length))).join(" ");
      return {
        modelVersion: served.version,
        output,
        usage: { promptTokens: countTokens(prompt), completionTokens: countTokens(output) },
        backend: "mock",
        mock: true,
      };
    },
  };
}

export const EADWYN_SYSTEM_PROMPT =
  "You are Eadwyn, an open, federated model grown by many communities. Answer plainly and briefly. " +
  "Say when you do not know. Technology serves human judgment: offer information, not orders.";

/** The subset of the Workers AI binding the edge uses. */
export type WorkersAiRun = (
  model: string,
  inputs: {
    messages: { role: "system" | "user"; content: string }[];
    max_tokens: number;
    lora?: string;
  },
) => Promise<unknown>;

export function createWorkersAiBackend(options: {
  run: WorkersAiRun;
  model: string;
  adapter?: string;
}): InferenceBackend {
  return {
    name: "workers-ai",
    model: options.model,
    adapter: options.adapter,
    async infer({ prompt, maxTokens, served }) {
      const raw = (await options.run(options.model, {
        messages: [
          { role: "system", content: EADWYN_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        max_tokens: maxTokens,
        ...(options.adapter ? { lora: options.adapter } : {}),
      })) as { response?: unknown; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      if (typeof raw?.response !== "string") {
        throw new Error("Workers AI returned no text");
      }
      return {
        modelVersion: served.version,
        output: raw.response,
        usage: {
          promptTokens: raw.usage?.prompt_tokens ?? countTokens(prompt),
          completionTokens: raw.usage?.completion_tokens ?? countTokens(raw.response),
        },
        backend: "workers-ai",
        model: options.model,
        adapter: options.adapter,
        mock: false,
      };
    },
  };
}

export function createUpstreamBackend(options: {
  url: string;
  fetch?: typeof fetch;
  /** Cloudflare Access service token for a Pod behind Access. */
  accessClientId?: string;
  accessClientSecret?: string;
  bearerToken?: string;
  timeoutMs?: number;
}): InferenceBackend {
  const fetchImpl = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  return {
    name: "upstream",
    model: new URL(options.url).host,
    async infer({ prompt, maxTokens }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
      try {
        const response = await fetchImpl(new URL("/v1/infer", options.url), {
          method: "POST",
          signal: controller.signal,
          headers: {
            "content-type": "application/json",
            ...(options.accessClientId && options.accessClientSecret
              ? {
                  "cf-access-client-id": options.accessClientId,
                  "cf-access-client-secret": options.accessClientSecret,
                }
              : {}),
            ...(options.bearerToken ? { authorization: `Bearer ${options.bearerToken}` } : {}),
          },
          body: JSON.stringify({ prompt, maxTokens }),
        });
        if (!response.ok) {
          throw new Error(`upstream inference failed with HTTP ${response.status}`);
        }
        // The Pod speaks the same contract; the edge re-labels where the answer came from.
        const answer = InferenceResponseSchema.parse(await response.json());
        return {
          ...answer,
          backend: "upstream" as const,
          model: answer.model ?? new URL(options.url).host,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
