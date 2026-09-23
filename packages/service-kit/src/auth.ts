/**
 * Who is calling: the public internet, or another Eadwyn service.
 *
 * Every entrypoint stamps the request with a trusted caller header after
 * discarding whatever the client sent:
 *  - Cloudflare: the default `fetch` export stamps "public"; the named
 *    `InternalApi` entrypoint, reachable only through service bindings,
 *    stamps "internal".
 *  - Node: "internal" when no INTERNAL_API_TOKEN is configured (local
 *    development), otherwise only for requests bearing that token.
 *
 * Routes that change what the federation believes (publish a version, report
 * round progress, submit a merge candidate) require an internal caller.
 */
import type { Context, MiddlewareHandler } from "hono";
import { HttpError } from "./errors";

export const CALLER_HEADER = "x-eadwyn-caller";
export type Caller = "public" | "internal";

export function withCaller(request: Request, caller: Caller): Request {
  const headers = new Headers(request.headers);
  headers.set(CALLER_HEADER, caller);
  return new Request(request, { headers });
}

/**
 * Like `withCaller`, but buffers the body first. Use it when forwarding to a
 * Durable Object: if the object answers without reading a streamed body (a
 * refused request), the Worker would otherwise keep pumping the stream after
 * its response was sent. Bodies here are small JSON documents.
 */
export async function withCallerBuffered(
  request: Request,
  caller: Caller,
  maxBytes = 1_048_576,
): Promise<Request> {
  const headers = new Headers(request.headers);
  headers.set(CALLER_HEADER, caller);
  if (!request.body) {
    return new Request(request.url, { method: request.method, headers });
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) {
    throw new HttpError(413, "payload_too_large", `request body exceeds ${maxBytes} bytes`);
  }
  const body = await request.arrayBuffer();
  if (body.byteLength > maxBytes) {
    throw new HttpError(413, "payload_too_large", `request body exceeds ${maxBytes} bytes`);
  }
  return new Request(request.url, { method: request.method, headers, body });
}

export function callerOf(c: Context): Caller {
  return c.req.header(CALLER_HEADER) === "internal" ? "internal" : "public";
}

export function bearerToken(c: Context): string | undefined {
  const header = c.req.header("authorization");
  if (!header?.toLowerCase().startsWith("bearer ")) return undefined;
  return header.slice(7).trim() || undefined;
}

/** Constant-time string comparison (length is not hidden). */
export function safeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.byteLength !== right.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < left.byteLength; i += 1) {
    diff |= (left[i] as number) ^ (right[i] as number);
  }
  return diff === 0;
}

/** Only other Eadwyn services may call this route. */
export function requireInternal(): MiddlewareHandler {
  return async (c, next) => {
    if (callerOf(c) !== "internal") {
      throw new HttpError(403, "internal_only", "This route is reserved for Eadwyn services");
    }
    await next();
  };
}

/**
 * Operator actions (start a merge, force an edge sync): other services, or a
 * holder of the operator token. With no token configured, only services.
 */
export function requireOperator(token: string | undefined): MiddlewareHandler {
  return async (c, next) => {
    if (callerOf(c) === "internal") {
      await next();
      return;
    }
    const presented = bearerToken(c);
    if (!token || !presented) {
      throw new HttpError(401, "operator_auth_required", "This route requires the operator token");
    }
    if (!safeEqual(presented, token)) {
      throw new HttpError(403, "operator_auth_invalid", "The operator token is not valid");
    }
    await next();
  };
}
