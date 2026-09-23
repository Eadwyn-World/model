/**
 * ModelRegistry — the source of truth for "which global model is current".
 *
 * Backed by a JSON file today. The interface is the contract; the coordinator
 * owns the canonical registry and the inference edge keeps a served copy.
 */
import { createJsonStore, type JsonStore } from "@eadwyn/service-kit";
import {
  type ArtifactRef,
  bumpVersion,
  compareVersions,
  type ModelVersion,
  ModelVersionSchema,
  SemverSchema,
  type VersionPart,
} from "@eadwyn/shared-protocol";
import { z } from "zod";
import { seedRegistry } from "./seed";

export const RegistryStateSchema = z.object({
  currentVersion: SemverSchema,
  versions: z.array(ModelVersionSchema),
});
export type RegistryState = z.infer<typeof RegistryStateSchema>;

export interface PublishInput {
  /** Must match the current version; protects against publishing on a stale base. */
  parentVersion?: string;
  /** Which part of the version to bump. Merges bump `minor`. */
  part?: VersionPart;
  checkpoint: ArtifactRef;
  changelog: string;
  mergeCandidateId?: string;
  architecture?: string;
  parameterCount?: number;
  license?: string;
  publishedAt?: string;
}

export interface ModelRegistry {
  getCurrent(): Promise<ModelVersion>;
  getVersion(version: string): Promise<ModelVersion | undefined>;
  /** Newest first. */
  listVersions(): Promise<ModelVersion[]>;
  publish(input: PublishInput): Promise<ModelVersion>;
  /** Replace the registry with the seed history. Tests and demos only. */
  reset(): Promise<void>;
}

export class ModelRegistryError extends Error {
  readonly code: "stale_parent" | "version_exists";
  constructor(code: ModelRegistryError["code"], message: string) {
    super(message);
    this.name = "ModelRegistryError";
    this.code = code;
  }
}

export interface ModelRegistryOptions {
  filePath: string;
  seed?: () => RegistryState;
}

export function createModelRegistry(options: ModelRegistryOptions): ModelRegistry {
  const store: JsonStore<RegistryState> = createJsonStore({
    filePath: options.filePath,
    seed: options.seed ?? (() => seedRegistry()),
    parse: (raw) => RegistryStateSchema.parse(raw),
  });

  const current = (state: RegistryState): ModelVersion => {
    const found = state.versions.find((v) => v.version === state.currentVersion);
    if (!found) {
      throw new Error(`registry is inconsistent: current version ${state.currentVersion} missing`);
    }
    return found;
  };

  return {
    async getCurrent() {
      return current(await store.read());
    },
    async getVersion(version) {
      return (await store.read()).versions.find((v) => v.version === version);
    },
    async listVersions() {
      return (await store.read()).versions
        .slice()
        .sort((a, b) => compareVersions(b.version, a.version));
    },
    publish(input) {
      return store.update((state) => {
        const head = current(state);
        if (input.parentVersion && input.parentVersion !== head.version) {
          throw new ModelRegistryError(
            "stale_parent",
            `cannot publish on ${input.parentVersion}; current version is ${head.version}`,
          );
        }
        const version = bumpVersion(head.version, input.part ?? "minor");
        if (state.versions.some((v) => v.version === version)) {
          throw new ModelRegistryError("version_exists", `version ${version} already exists`);
        }
        const published: ModelVersion = ModelVersionSchema.parse({
          version,
          parentVersion: head.version,
          architecture: input.architecture ?? head.architecture,
          parameterCount: input.parameterCount ?? head.parameterCount,
          checkpoint: input.checkpoint,
          mergeCandidateId: input.mergeCandidateId,
          changelog: input.changelog,
          license: input.license ?? head.license,
          publishedAt: input.publishedAt ?? new Date().toISOString(),
        });
        state.versions.push(published);
        state.currentVersion = published.version;
        return published;
      });
    },
    async reset() {
      await store.reset();
    },
  };
}
