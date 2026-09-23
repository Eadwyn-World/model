/**
 * Federation data for the AI Model page.
 *
 * One function, one shape. It asks the coordinator and governance through the
 * federation SDK; if the coordinator is unreachable it returns the built-in
 * snapshot so the page always renders, and says so in `source`.
 *
 * On Cloudflare the SDK's transports are the Worker's service bindings, so
 * the calls stay inside Cloudflare's network and need no public service URL.
 * On Node they are plain HTTP to COORDINATOR_URL / GOVERNANCE_URL.
 */
import { createFederationClient, type FederationClientOptions } from "@eadwyn/federation-sdk";
import type { FederationStats } from "@eadwyn/shared-protocol";
import { sampleFederationStats, sampleGovernanceSummary } from "@eadwyn/shared-protocol/fixtures";
import { serverEnv } from "./env";

export interface FederationSnapshot {
  stats: FederationStats;
  governance: { pendingMerges: number; reviewers: number } | null;
  source: {
    mode: "live" | "snapshot";
    coordinatorUrl: string;
    /** Why the page fell back to the snapshot, when it did. */
    reason?: string;
  };
  fetchedAt: string;
}

export async function getFederationSnapshot(): Promise<FederationSnapshot> {
  const env = serverEnv();
  const now = new Date();

  if (env.EADWYN_DATA_SOURCE === "mock") {
    return snapshotFallback(env.COORDINATOR_URL, now, "EADWYN_DATA_SOURCE=mock");
  }

  const bindings = await serviceBindings();
  const client = createFederationClient(
    bindings
      ? { transports: bindings, timeoutMs: 1_500 }
      : {
          coordinatorUrl: env.COORDINATOR_URL,
          governanceUrl: env.GOVERNANCE_URL,
          timeoutMs: 1_500,
        },
  );
  const coordinatorLabel = bindings ? "service binding: eadwyn-coordinator" : env.COORDINATOR_URL;

  const [stats, merges, reviewers] = await Promise.allSettled([
    client.coordinator.getStats(),
    client.governance.listMerges("pending"),
    client.governance.listReviewers(),
  ]);

  if (stats.status === "rejected") {
    const reason = stats.reason instanceof Error ? stats.reason.message : String(stats.reason);
    if (env.EADWYN_DATA_SOURCE === "live") {
      throw new Error(`coordinator unreachable: ${reason}`);
    }
    return snapshotFallback(coordinatorLabel, now, reason);
  }

  return {
    stats: stats.value,
    governance:
      merges.status === "fulfilled"
        ? {
            pendingMerges: merges.value.total,
            reviewers: reviewers.status === "fulfilled" ? reviewers.value.total : 0,
          }
        : null,
    source: { mode: "live", coordinatorUrl: coordinatorLabel },
    fetchedAt: now.toISOString(),
  };
}

function snapshotFallback(coordinatorUrl: string, now: Date, reason: string): FederationSnapshot {
  return {
    stats: sampleFederationStats(now),
    governance: sampleGovernanceSummary(),
    source: { mode: "snapshot", coordinatorUrl, reason },
    fetchedAt: now.toISOString(),
  };
}

/**
 * The Worker's COORDINATOR and GOVERNANCE service bindings, when this code is
 * running inside Cloudflare Workers (OpenNext). Undefined on Node and during
 * the build, where the page falls back to HTTP or the snapshot.
 */
async function serviceBindings(): Promise<FederationClientOptions["transports"] | undefined> {
  if (globalThis.navigator?.userAgent !== "Cloudflare-Workers") {
    return undefined;
  }
  const { getCloudflareContext } = await import("@opennextjs/cloudflare");
  const env = getCloudflareContext().env as unknown as Record<
    string,
    { fetch: typeof fetch } | undefined
  >;
  const bind = (binding: { fetch: typeof fetch } | undefined) =>
    binding
      ? (((input: RequestInfo | URL, init?: RequestInit) =>
          binding.fetch(input, init)) as typeof fetch)
      : undefined;
  const coordinator = bind(env.COORDINATOR);
  if (!coordinator) {
    return undefined;
  }
  return { coordinator, governance: bind(env.GOVERNANCE) };
}
