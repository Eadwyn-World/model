/**
 * ModelRegistry — the source of truth for "which global model is current".
 *
 * Built on the three-method store, so it runs on any backend: a JSON file on
 * Node, a D1 row on Cloudflare. The coordinator owns the canonical registry;
 * the inference edge keeps a served copy and `adopt`s published versions.
 */
import type { JsonStore } from "@eadwyn/service-kit";
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

export interface PublishResult {
  model: ModelVersion;
  /** False when this candidate had already been published (an idempotent replay). */
  created: boolean;
}

export interface ModelRegistry {
  getCurrent(): Promise<ModelVersion>;
  getVersion(version: string): Promise<ModelVersion | undefined>;
  /** The version a merge candidate became, if it was published. */
  findByCandidate(candidateId: string): Promise<ModelVersion | undefined>;
  /** Newest first. */
  listVersions(): Promise<ModelVersion[]>;
  /**
   * Publishes the next version. Publishing the same merge candidate twice
   * returns the version it already became, so callers can retry safely.
   */
  publish(input: PublishInput): Promise<PublishResult>;
  /**
   * Records a version published elsewhere (the edge adopting what the
   * coordinator published). Becomes current only if it is newer.
   */
  adopt(model: ModelVersion): Promise<{ current: ModelVersion; adopted: boolean }>;
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
  store: JsonStore<RegistryState>;
}

export function registryCodec(seed: () => RegistryState = () => seedRegistry()) {
  return { seed, parse: (raw: unknown) => RegistryStateSchema.parse(raw) };
}

export function createModelRegistry(options: ModelRegistryOptions): ModelRegistry {
  const { store } = options;

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
    async findByCandidate(candidateId) {
      return (await store.read()).versions.find((v) => v.mergeCandidateId === candidateId);
    },
    async listVersions() {
      return (await store.read()).versions
        .slice()
        .sort((a, b) => compareVersions(b.version, a.version));
    },
    publish(input) {
      return store.update((state) => {
        if (input.mergeCandidateId) {
          const already = state.versions.find((v) => v.mergeCandidateId === input.mergeCandidateId);
          if (already) {
            return { model: already, created: false };
          }
        }
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
        const model: ModelVersion = ModelVersionSchema.parse({
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
        state.versions.push(model);
        state.currentVersion = model.version;
        return { model, created: true };
      });
    },
    adopt(model) {
      const parsed = ModelVersionSchema.parse(model);
      return store.update((state) => {
        if (!state.versions.some((v) => v.version === parsed.version)) {
          state.versions.push(parsed);
        }
        const newer = compareVersions(parsed.version, state.currentVersion) > 0;
        if (newer) {
          state.currentVersion = parsed.version;
        }
        return { current: current(state), adopted: newer };
      });
    },
    async reset() {
      await store.reset();
    },
  };
}
