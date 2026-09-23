/**
 * Polls a health endpoint until it answers. Used by scripts and demos that
 * start right after `pnpm dev`.
 */
import type { HealthResponse } from "@eadwyn/shared-protocol";

export interface WaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

export async function waitForHealthy(
  label: string,
  health: () => Promise<HealthResponse>,
  options: WaitOptions = {},
): Promise<HealthResponse> {
  const { timeoutMs = 20_000, intervalMs = 500 } = options;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await health();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  throw new Error(
    `${label} did not become healthy within ${timeoutMs}ms: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}
