/**
 * Cloudflare Access identity.
 *
 * When a route sits behind an Access application, Cloudflare adds a signed
 * JWT in `Cf-Access-Jwt-Assertion`. Verifying it here (signature against the
 * team's published keys, audience, issuer, expiry) means the Worker does not
 * have to trust the network path: a request that skipped Access has no valid
 * token and is refused.
 */
import { verifyWithJwks } from "hono/jwt";

export const ACCESS_JWT_HEADER = "cf-access-jwt-assertion";

export interface AccessConfig {
  /** e.g. `eadwyn.cloudflareaccess.com` */
  teamDomain: string;
  /** The Access application's AUD tag. */
  audience: string;
}

export interface AccessIdentity {
  /** Email for people; the service token's client id for machines. */
  id: string;
  email?: string;
  subject: string;
}

export interface AccessVerifierOptions {
  fetch?: typeof fetch;
  /** Pin keys (tests, air-gapped setups) instead of fetching the team's certs. */
  keys?: JsonWebKey[];
  cacheSeconds?: number;
  now?: () => number;
}

export type AccessVerifier = (token: string) => Promise<AccessIdentity>;

export class AccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessDeniedError";
  }
}

export function createAccessVerifier(
  config: AccessConfig,
  options: AccessVerifierOptions = {},
): AccessVerifier {
  const teamDomain = config.teamDomain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const issuer = `https://${teamDomain}`;
  const certsUrl = `${issuer}/cdn-cgi/access/certs`;
  const fetchImpl = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const now = options.now ?? (() => Date.now());
  const ttl = (options.cacheSeconds ?? 600) * 1000;
  let cache: { keys: JsonWebKey[]; expires: number } | undefined;

  async function keys(): Promise<JsonWebKey[]> {
    if (options.keys) return options.keys;
    if (cache && cache.expires > now()) return cache.keys;
    const response = await fetchImpl(certsUrl);
    if (!response.ok) {
      throw new AccessDeniedError(`could not load Access signing keys (HTTP ${response.status})`);
    }
    const body = (await response.json()) as { keys?: JsonWebKey[] };
    cache = { keys: body.keys ?? [], expires: now() + ttl };
    return cache.keys;
  }

  return async (token) => {
    let payload: Record<string, unknown>;
    try {
      payload = (await verifyWithJwks(token, {
        keys: (await keys()) as never,
        allowedAlgorithms: ["RS256"],
        verification: { iss: issuer, aud: config.audience },
      })) as Record<string, unknown>;
    } catch (error) {
      if (error instanceof AccessDeniedError) throw error;
      throw new AccessDeniedError(
        `Access token rejected: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const email = typeof payload.email === "string" ? payload.email : undefined;
    const commonName = typeof payload.common_name === "string" ? payload.common_name : undefined;
    const subject = typeof payload.sub === "string" ? payload.sub : (commonName ?? "");
    const id = email ?? commonName ?? subject;
    if (!id) {
      throw new AccessDeniedError("Access token carries no identity");
    }
    return { id, email, subject };
  };
}
