/**
 * Response cache: identical prompts to the same served version, backend,
 * model and adapter return the stored answer. KV on Cloudflare; a small
 * in-memory map on Node.
 */
import { canonicalJson, type InferenceResponse, sha256Hex } from "@eadwyn/shared-protocol";

export interface ResponseCache {
  get(key: string): Promise<InferenceResponse | null>;
  put(key: string, value: InferenceResponse, ttlSeconds: number): Promise<void>;
}

export async function cacheKey(parts: {
  modelVersion: string;
  backend: string;
  model?: string;
  adapter?: string;
  prompt: string;
  maxTokens: number;
}): Promise<string> {
  return `infer:v1:${await sha256Hex(canonicalJson(parts))}`;
}

export interface KvLike {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export function createKvCache(kv: KvLike): ResponseCache {
  return {
    get: async (key) => ((await kv.get(key, "json")) as InferenceResponse | null) ?? null,
    // KV's minimum TTL is 60 seconds.
    put: (key, value, ttl) =>
      kv.put(key, JSON.stringify(value), { expirationTtl: Math.max(60, ttl) }),
  };
}

export function createMemoryCache(limit = 500): ResponseCache {
  const entries = new Map<string, { value: InferenceResponse; expires: number }>();
  return {
    async get(key) {
      const hit = entries.get(key);
      if (!hit || hit.expires < Date.now()) {
        entries.delete(key);
        return null;
      }
      return hit.value;
    },
    async put(key, value, ttl) {
      if (entries.size >= limit) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
      entries.set(key, { value, expires: Date.now() + ttl * 1000 });
    },
  };
}
