/**
 * Who is deciding.
 *
 *  - `access`: the governance service sits behind a Cloudflare Access
 *    application. The reviewer is whoever Access authenticated; the Worker
 *    re-verifies the signed Access JWT, so a request that bypassed Access
 *    (another route, a forged header) has no identity and is refused.
 *  - `none`: local development. The reviewer names themselves in the body.
 */
import {
  ACCESS_JWT_HEADER,
  AccessDeniedError,
  type AccessVerifier,
  createAccessVerifier,
  HttpError,
} from "@eadwyn/service-kit";
import type { Context } from "hono";

export type ReviewerAuthMode = "access" | "none";

export interface ReviewerAuthConfig {
  mode: ReviewerAuthMode;
  teamDomain?: string;
  audience?: string;
  /** Optional pinned signing keys (JSON `{ "keys": [...] }`); fetched from the team domain otherwise. */
  jwks?: string;
}

export type ReviewerResolver = (c: Context, claimed: string | undefined) => Promise<string>;

export function createReviewerResolver(config: ReviewerAuthConfig): ReviewerResolver {
  if (config.mode === "none") {
    return async (_c, claimed) => {
      if (!claimed) {
        throw new HttpError(
          400,
          "reviewer_required",
          "reviewerId is required when reviewer authentication is off",
        );
      }
      return claimed;
    };
  }
  if (!config.teamDomain || !config.audience) {
    return async () => {
      throw new HttpError(
        503,
        "reviewer_auth_misconfigured",
        "Reviewer authentication is set to Cloudflare Access but ACCESS_TEAM_DOMAIN or ACCESS_AUD is missing",
      );
    };
  }
  const keys = config.jwks
    ? ((JSON.parse(config.jwks) as { keys: JsonWebKey[] }).keys ?? [])
    : undefined;
  const verify: AccessVerifier = createAccessVerifier(
    { teamDomain: config.teamDomain, audience: config.audience },
    { keys },
  );
  return async (c) => {
    const token = c.req.header(ACCESS_JWT_HEADER);
    if (!token) {
      throw new HttpError(
        401,
        "reviewer_auth_required",
        "Sign in through Cloudflare Access to review merges",
      );
    }
    try {
      return (await verify(token)).id;
    } catch (error) {
      if (error instanceof AccessDeniedError) {
        throw new HttpError(401, "reviewer_auth_invalid", error.message);
      }
      throw error;
    }
  };
}
