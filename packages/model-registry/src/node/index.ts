/**
 * Node helper: a registry backed by a JSON file. `@eadwyn/model-registry/node`.
 */
import { createFileStore } from "@eadwyn/service-kit/node";
import {
  createModelRegistry,
  type ModelRegistry,
  type RegistryState,
  registryCodec,
} from "../registry";

export function createFileModelRegistry(options: {
  filePath: string;
  seed?: () => RegistryState;
}): ModelRegistry {
  return createModelRegistry({
    store: createFileStore({ filePath: options.filePath, ...registryCodec(options.seed) }),
  });
}
