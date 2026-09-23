/**
 * GovernanceDecision — a reviewer's recorded verdict on a merge candidate.
 *
 * Decisions are append-only. The tally of decisions, not any single one,
 * moves a candidate from pending to approved or rejected.
 */
import { z } from "zod";
import { IsoDateTimeSchema, UuidSchema } from "./primitives";

export const VerdictSchema = z.enum(["approve", "reject"]);
export type Verdict = z.infer<typeof VerdictSchema>;

export const GovernanceDecisionSchema = z.object({
  decisionId: UuidSchema,
  candidateId: UuidSchema,
  reviewerId: z.string().min(1).max(80),
  verdict: VerdictSchema,
  rationale: z.string().min(1).max(2000),
  createdAt: IsoDateTimeSchema,
});
export type GovernanceDecision = z.infer<typeof GovernanceDecisionSchema>;
