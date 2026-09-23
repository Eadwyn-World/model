/**
 * Primitive schemas reused across every contract.
 *
 * Keep these small and boring: they are the vocabulary the rest of the
 * protocol is written in, and every service validates against them.
 */
import { z } from "zod";

/** Semantic version, e.g. `0.3.1` or `1.0.0-rc.1`. */
export const SemverSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, "expected a semantic version such as 0.3.1");

/** ISO-8601 timestamp. Offsets are accepted so nodes in any timezone can sign what they emit. */
export const IsoDateTimeSchema = z.iso.datetime({ offset: true });

/** Lowercase hex SHA-256 digest. */
export const Sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "expected a lowercase hex-encoded sha256 digest");

export const UuidSchema = z.uuid();

/** Base64 (standard alphabet) — used for Ed25519 keys and signatures. */
export const Base64Schema = z.base64();

/**
 * A content-addressed reference to a binary artifact (weights delta, checkpoint).
 * The protocol never carries the bytes themselves; only where they live and what
 * they hash to. This is the "only learning travels" boundary.
 */
export const ArtifactRefSchema = z.object({
  uri: z.string().min(1).max(512),
  sha256: Sha256Schema,
  bytes: z.number().int().nonnegative(),
});
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;
