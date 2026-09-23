/**
 * HttpError — the one error type route handlers throw.
 *
 * The app factory turns it into `{ error: { code, message, details } }` with
 * the right status, which is also the shape the federation SDK expects.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new HttpError(400, code, message, details);
export const unauthorized = (code: string, message: string) => new HttpError(401, code, message);
export const forbidden = (code: string, message: string) => new HttpError(403, code, message);
export const notFound = (what: string) => new HttpError(404, "not_found", `${what} not found`);
export const conflict = (code: string, message: string, details?: unknown) =>
  new HttpError(409, code, message, details);
export const unavailable = (code: string, message: string) => new HttpError(503, code, message);
