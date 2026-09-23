/**
 * Governance state: candidates under review, the append-only decision log,
 * and what happened when approved candidates were published.
 */
import { createJsonStore, type JsonStore } from "@eadwyn/service-kit";
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
  at: IsoDateTimeSchema,
});

export const GovernanceStateSchema = z.object({
  candidates: z.array(MergeCandidateSchema),
  decisions: z.array(GovernanceDecisionSchema),
  publications: z.record(z.string(), PublicationSchema),
});
export type GovernanceState = z.infer<typeof GovernanceStateSchema>;

export function seedGovernanceState(now = new Date()): GovernanceState {
  return sampleGovernanceHistory(now);
}

export type GovernanceStore = JsonStore<GovernanceState>;

export function createGovernanceStore(filePath: string, now?: () => Date): GovernanceStore {
  return createJsonStore({
    filePath,
    seed: () => seedGovernanceState(now?.()),
    parse: (raw) => GovernanceStateSchema.parse(raw),
  });
}
