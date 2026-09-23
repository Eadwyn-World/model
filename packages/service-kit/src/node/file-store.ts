/**
 * JSON-file variant of the store (Node only): the local-development default.
 * Atomic writes (temp file + rename); one process per data directory.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createStoreFromBackend } from "../stores/core";
import type { JsonStore, StoreCodec } from "../stores/types";

export interface FileStoreOptions<T> extends StoreCodec<T> {
  filePath: string;
}

export function createFileStore<T>(options: FileStoreOptions<T>): JsonStore<T> {
  const { filePath } = options;
  return createStoreFromBackend(
    {
      location: `file:${filePath}`,
      cacheable: true,
      async load() {
        try {
          return { json: await readFile(filePath, "utf8"), revision: null };
        } catch (error) {
          if ((error as { code?: string }).code === "ENOENT") return null;
          throw error;
        }
      },
      async save(json) {
        await mkdir(dirname(filePath), { recursive: true });
        const tmp = `${filePath}.${process.pid}.tmp`;
        await writeFile(tmp, `${JSON.stringify(JSON.parse(json), null, 2)}\n`, "utf8");
        await rename(tmp, filePath);
        // A single process owns the file, so revisions are not needed for CAS.
        return "file";
      },
    },
    options,
  );
}
