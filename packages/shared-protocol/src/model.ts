/**
 * ModelVersion — a published state of the global model.
 */
import { z } from "zod";
import { ArtifactRefSchema, IsoDateTimeSchema, SemverSchema, UuidSchema } from "./primitives";

export const ModelVersionSchema = z.object({
  version: SemverSchema,
  parentVersion: SemverSchema.optional(),
  /** Model family / architecture identifier, e.g. `eadwyn-lm/seed-124m`. */
  architecture: z.string().min(1).max(120),
  parameterCount: z.number().int().positive().optional(),
  checkpoint: ArtifactRefSchema,
  /** Which reviewed merge produced this version (absent for the genesis version). */
  mergeCandidateId: UuidSchema.optional(),
  changelog: z.string().max(2000),
  license: z.string().min(1).max(80),
  publishedAt: IsoDateTimeSchema,
});
export type ModelVersion = z.infer<typeof ModelVersionSchema>;
