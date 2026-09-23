/**
 * A knowledge item is the unit of "share knowledge": something a person or a
 * node contributes that a local training round can learn from.
 *
 * Items carry provenance (source, contributor) because the model's philosophy
 * says every contribution is recognised, and because reviewers need to trace
 * what a merge learned from.
 */
import { IsoDateTimeSchema } from "@eadwyn/shared-protocol";
import { z } from "zod";

export const KnowledgeTypeSchema = z.enum(["field-note", "lore", "correction", "observation"]);
export type KnowledgeType = z.infer<typeof KnowledgeTypeSchema>;

export const KnowledgeSourceSchema = z.object({
  kind: z.enum(["pod", "node", "document", "contributor"]),
  /** Pod id, node id, document anchor or contributor id. */
  ref: z.string().min(1).max(200),
});
export type KnowledgeSource = z.infer<typeof KnowledgeSourceSchema>;

export const ContributorSchema = z.object({
  id: z.string().min(1).max(80),
  displayName: z.string().min(1).max(80),
  podId: z.string().min(1).max(80).optional(),
});
export type Contributor = z.infer<typeof ContributorSchema>;

export const KnowledgeStatusSchema = z.enum(["proposed", "accepted", "merged"]);
export type KnowledgeStatus = z.infer<typeof KnowledgeStatusSchema>;

export const KnowledgeItemSchema = z.object({
  id: z.string().regex(/^ki-[a-z0-9][a-z0-9-]*$/, "ids look like ki-0001 or ki-solar-lull"),
  title: z.string().min(1).max(160),
  type: KnowledgeTypeSchema,
  source: KnowledgeSourceSchema,
  /** Content summary. The full content stays with its source; only the summary is indexed. */
  summary: z.string().min(1).max(2000),
  tags: z.array(z.string().min(1).max(40)).max(16),
  contributor: ContributorSchema,
  /** For corrections: the item being corrected. */
  supersedes: z.string().optional(),
  status: KnowledgeStatusSchema.default("accepted"),
  createdAt: IsoDateTimeSchema,
});
export type KnowledgeItem = z.infer<typeof KnowledgeItemSchema>;
export type KnowledgeItemInput = z.input<typeof KnowledgeItemSchema>;
