/**
 * Filesystem object store (Node only). Objects live under
 * `<root>/<bucket>/<key>` with a `.meta.json` sidecar holding the verified
 * sha256, so `head` never has to re-hash.
 */
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { ObjectStoreBucket } from "@eadwyn/shared-protocol";
import { ObjectIntegrityError, type ObjectStore } from "../objects/types";

export function createFileObjectStore(rootDir: string): ObjectStore {
  const root = resolve(rootDir);
  const pathOf = (bucket: ObjectStoreBucket, key: string) => {
    const full = resolve(join(root, bucket, key));
    if (!full.startsWith(`${root}${sep}`)) {
      throw new Error(`object key escapes the store: ${key}`);
    }
    return full;
  };

  return {
    kind: "filesystem",
    async head(bucket, key) {
      const path = pathOf(bucket, key);
      try {
        const meta = JSON.parse(await readFile(`${path}.meta.json`, "utf8")) as { sha256: string };
        const info = await stat(path);
        return { bucket, key, bytes: info.size, sha256: meta.sha256 };
      } catch {
        return null;
      }
    },
    async get(bucket, key) {
      try {
        return new Uint8Array(await readFile(pathOf(bucket, key)));
      } catch {
        return null;
      }
    },
    async put(bucket, key, body, expected) {
      const path = pathOf(bucket, key);
      await mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.${process.pid}.${Date.now()}.upload`;
      const hash = createHash("sha256");
      let bytes = 0;
      const out = createWriteStream(tmp);
      const write = (chunk: Uint8Array) =>
        new Promise<void>((done, fail) =>
          out.write(chunk, (error) => (error ? fail(error) : done())),
        );
      try {
        if (body instanceof Uint8Array) {
          hash.update(body);
          bytes = body.byteLength;
          await write(body);
        } else {
          const reader = body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > expected.bytes) {
              await reader.cancel();
              break;
            }
            hash.update(value);
            await write(value);
          }
        }
        await new Promise<void>((done, fail) =>
          out.end((error?: Error | null) => (error ? fail(error) : done())),
        );
        const sha256 = hash.digest("hex");
        if (bytes !== expected.bytes || sha256 !== expected.sha256) {
          throw new ObjectIntegrityError(key, expected, { bytes, sha256 });
        }
        await rename(tmp, path);
        await writeFile(`${path}.meta.json`, JSON.stringify({ sha256, bytes }), "utf8");
        return { bucket, key, bytes, sha256 };
      } catch (error) {
        out.destroy();
        await rm(tmp, { force: true });
        throw error;
      }
    },
  };
}
