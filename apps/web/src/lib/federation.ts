/**
 * Federation data for the AI Model page.
 *
 * One function, one shape. It asks the coordinator and governance through the
 * federation SDK; if the coordinator is unreachable it returns the built-in
 * snapshot so the page always renders, and says so in `source`.
 */
import { createFederationClient } from "@eadwyn/federation-sdk";
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

  const client = createFederationClient({
    coordinatorUrl: env.COORDINATOR_URL,
    governanceUrl: env.GOVERNANCE_URL,
    timeoutMs: 1_500,
  });

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
    return snapshotFallback(env.COORDINATOR_URL, now, reason);
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
    source: { mode: "live", coordinatorUrl: env.COORDINATOR_URL },
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
