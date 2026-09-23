/**
 * Error transport across Durable Object RPC.
 *
 * Errors thrown inside an RPC method reach the caller as plain Errors; the
 * HTTP status and code are lost. Methods that can refuse a request return an
 * RpcResult instead, and the caller turns it back into an HttpError.
 */
import { HttpError } from "./errors";

export type RpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { status: number; code: string; message: string; details?: unknown } };

export async function toRpcResult<T>(task: () => Promise<T>): Promise<RpcResult<T>> {
  try {
    return { ok: true, value: await task() };
  } catch (error) {
    if (error instanceof HttpError) {
      return {
        ok: false,
        error: {
          status: error.status,
          code: error.code,
          message: error.message,
          details: error.details,
        },
      };
    }
    throw error;
  }
}

export function fromRpcResult<T>(result: RpcResult<T>): T {
  if (result.ok) return result.value;
  throw new HttpError(
    result.error.status,
    result.error.code,
    result.error.message,
    result.error.details,
  );
}
