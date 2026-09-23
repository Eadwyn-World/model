/**
 * Runs a cross-service signal without letting its failure break the caller.
 *
 * The federation is designed so that one service being down degrades the
 * others instead of stopping them ("resilience over perfection"). Signals
 * that must not be lost should be persisted and retried; today they are
 * logged and reported to the caller through the return value.
 */
import type { Logger } from "./logger";

export async function bestEffort<T>(
  logger: Logger,
  label: string,
  task: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    const value = await task();
    return { ok: true, value };
  } catch (error) {
    logger.warn(`${label} failed (continuing)`, { error });
    return { ok: false, error };
  }
}
