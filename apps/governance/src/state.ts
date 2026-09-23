/**
 * Governance state: candidates under review, the append-only decision log,
 * and what happened when approved candidates were published.
 */
import type { JsonStore, StoreCodec } from "@eadwyn/service-kit";
import {
  GovernanceDecisionSchema,
  IsoDateTimeSchema,
  MergeCandidateSchema,
  SemverSchema,
} from "@eadwyn/shared-protocol";
import { sampleGovernanceHistory } from "@eadwyn/shared-protocol/fixtures";
import { z } from "zod";

export const PublicationSchema = z.object({
  version: SemverSchema.optional(),
  error: z.string().optional(),
  /** False once retrying cannot help (stale base, version exists). */
  retryable: z.boolean().optional(),
  attempts: z.number().int().nonnegative().optional(),
  at: IsoDateTimeSchema,
});
export type Publication = z.infer<typeof PublicationSchema>;

export const GovernanceStateSchema = z.object({
  candidates: z.array(MergeCandidateSchema),
  decisions: z.array(GovernanceDecisionSchema),
  publications: z.record(z.string(), PublicationSchema),
});
export type GovernanceState = z.infer<typeof GovernanceStateSchema>;

export type SeedMode = "fixtures" | "genesis";

export function emptyGovernanceState(): GovernanceState {
  return { candidates: [], decisions: [], publications: {} };
}

export function seedGovernanceState(
  mode: SeedMode = "fixtures",
  now = new Date(),
): GovernanceState {
  return mode === "genesis" ? emptyGovernanceState() : sampleGovernanceHistory(now);
}

export function governanceCodec(
  mode: SeedMode = "fixtures",
  now?: () => Date,
): StoreCodec<GovernanceState> {
  return {
    seed: () => seedGovernanceState(mode, now?.()),
    parse: (raw) => GovernanceStateSchema.parse(raw),
  };
}

export type GovernanceStore = JsonStore<GovernanceState>;
