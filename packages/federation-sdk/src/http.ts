/**
 * The single HTTP primitive behind every SDK method: fetch, time out, decode,
 * validate against the response schema, and normalise failures into one
 * error type.
 */
import { ApiErrorSchema } from "@eadwyn/shared-protocol";
import type { ZodType, z } from "zod";

export class FederationApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly url: string;
  readonly details: unknown;

  constructor(input: {
    status: number;
    code: string;
    message: string;
    url: string;
    details?: unknown;
  }) {
    super(input.message);
    this.name = "FederationApiError";
    this.status = input.status;
    this.code = input.code;
    this.url = input.url;
    this.details = input.details;
  }
}

export interface HttpOptions {
  fetch: typeof fetch;
  timeoutMs: number;
  headers: Record<string, string>;
}

export interface RequestInput<S extends ZodType> {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  schema: S;
}

export async function request<S extends ZodType>(
  baseUrl: string | undefined,
  path: string,
  input: RequestInput<S>,
  options: HttpOptions,
): Promise<z.output<S>> {
  if (!baseUrl) {
    throw new FederationApiError({
      status: 0,
      code: "not_configured",
      message: `no base URL configured for ${path}`,
      url: path,
    });
  }
  const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  let response: Response;
  try {
    response = await options.fetch(url, {
      method: input.method ?? "GET",
      headers: {
        accept: "application/json",
        ...(input.body !== undefined ? { "content-type": "application/json" } : {}),
        ...options.headers,
      },
      body: input.body !== undefined ? JSON.stringify(input.body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new FederationApiError({
      status: 0,
      code: aborted ? "timeout" : "network_error",
      message: aborted
        ? `request to ${url} timed out after ${options.timeoutMs}ms`
        : `request to ${url} failed: ${error instanceof Error ? error.message : String(error)}`,
      url: url.toString(),
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }

  if (!response.ok) {
    const parsed = ApiErrorSchema.safeParse(json);
    throw new FederationApiError({
      status: response.status,
      code: parsed.success ? parsed.data.error.code : "http_error",
      message: parsed.success ? parsed.data.error.message : `HTTP ${response.status} from ${url}`,
      url: url.toString(),
      details: parsed.success ? parsed.data.error.details : json,
    });
  }

  const validated = input.schema.safeParse(json);
  if (!validated.success) {
    throw new FederationApiError({
      status: response.status,
      code: "invalid_response",
      message: `response from ${url} did not match the protocol`,
      url: url.toString(),
      details: validated.error.issues,
    });
  }
  return validated.data;
}
