/**
 * OpenNext adapter configuration: how the AI Model page runs as a Worker.
 *  - ISR pages (the page revalidates every 30 s) are cached in KV.
 *  - Time-based revalidation is queued through OpenNext's Durable Object queue.
 */
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import kvIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/kv-incremental-cache";
import doQueue from "@opennextjs/cloudflare/overrides/queue/do-queue";

export default defineCloudflareConfig({
  incrementalCache: kvIncrementalCache,
  queue: doQueue,
});
