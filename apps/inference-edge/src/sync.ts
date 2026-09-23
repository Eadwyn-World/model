/**
 * Keeps the served model in step with the coordinator: fetch the current
 * published version and adopt it if it is newer. On Cloudflare a Cron
 * Trigger runs this every five minutes; on Node, a timer.
 */
import type { ModelRegistry } from "@eadwyn/model-registry";
import type { EdgeSyncResponse, ModelVersion } from "@eadwyn/shared-protocol";

export async function syncServedModel(
  registry: ModelRegistry,
  fetchCurrent: () => Promise<ModelVersion>,
): Promise<EdgeSyncResponse> {
  const before = await registry.getCurrent();
  let published: ModelVersion;
  try {
    published = await fetchCurrent();
  } catch (error) {
    return {
      servedVersion: before.version,
      adopted: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const { current, adopted } = await registry.adopt(published);
  return { servedVersion: current.version, coordinatorVersion: published.version, adopted };
}
