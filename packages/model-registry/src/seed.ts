/**
 * Seed history for a fresh registry. Versions are relative to `now` so a new
 * checkout looks alive: the current model was published a couple of days ago.
 */
import type { ModelVersion } from "@eadwyn/shared-protocol";
import { sampleModelVersion } from "@eadwyn/shared-protocol/fixtures";
import type { RegistryState } from "./registry";

const daysAgo = (now: Date, days: number) =>
  new Date(now.getTime() - days * 24 * 60 * 60_000).toISOString();

export function seedRegistry(now = new Date()): RegistryState {
  const current = sampleModelVersion(now);
  const versions: ModelVersion[] = [
    {
      version: "0.1.0",
      architecture: current.architecture,
      parameterCount: current.parameterCount,
      checkpoint: {
        uri: "eadwyn://checkpoints/0.1.0/model.safetensors",
        sha256: "1a7f3e5c9b2d4f6a8c0e2d4f6a8c0e2d4f6a8c0e2d4f6a8c0e2d4f6a8c0e2d4f",
        bytes: 249_561_088,
      },
      changelog: "Genesis checkpoint: open recipe, public weights, trained on the seed corpus.",
      license: current.license,
      publishedAt: daysAgo(now, 142),
    },
    {
      version: "0.2.0",
      parentVersion: "0.1.0",
      architecture: current.architecture,
      parameterCount: current.parameterCount,
      checkpoint: {
        uri: "eadwyn://checkpoints/0.2.0/model.safetensors",
        sha256: "2b8e4f6d0c3e5a7b9d1f3a5c7e9b1d3f5a7c9e1b3d5f7a9c1e3b5d7f9a1c3e5b",
        bytes: 249_561_088,
      },
      changelog: "First federated merge: 23 nodes across 4 Catalyst Pods.",
      license: current.license,
      publishedAt: daysAgo(now, 93),
    },
    {
      version: "0.3.0",
      parentVersion: "0.2.0",
      architecture: current.architecture,
      parameterCount: current.parameterCount,
      checkpoint: {
        uri: "eadwyn://checkpoints/0.3.0/model.safetensors",
        sha256: "3c9f5a7e1d4f6b8c0e2a4c6e8a0c2e4a6c8e0a2c4e6a8c0e2a4c6e8a0c2e4a6c",
        bytes: 249_561_088,
      },
      changelog:
        "Lore and field notes from the first home nodes; new harvest-calendar corrections.",
      license: current.license,
      publishedAt: daysAgo(now, 39),
    },
    current,
  ];
  return { currentVersion: current.version, versions };
}
