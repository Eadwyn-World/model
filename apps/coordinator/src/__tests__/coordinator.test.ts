import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileModelRegistry } from "@eadwyn/model-registry/node";
import { CALLER_HEADER, createLogger } from "@eadwyn/service-kit";
import { createFileStore } from "@eadwyn/service-kit/node";
import { afterEach } from "vitest";
import { createCoordinatorApp } from "../app";
import { coordinatorCodec } from "../state";
import { coordinatorContract } from "./contract";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

coordinatorContract(async () => {
  const dir = await mkdtemp(join(tmpdir(), "eadwyn-coordinator-"));
  dirs.push(dir);
  const app = createCoordinatorApp({
    store: createFileStore({
      filePath: join(dir, "coordinator.json"),
      ...coordinatorCodec("fixtures"),
    }),
    registry: createFileModelRegistry({ filePath: join(dir, "model-registry.json") }),
    logger: createLogger({ service: "coordinator-test", level: "error" }),
    config: { expectedNodes: 128, onlineWindowMinutes: 360 },
  });
  // In production the entrypoint stamps the caller; here the test plays that role.
  return async (path, init = {}, caller = "public") => {
    const headers = new Headers(init.headers);
    headers.set(CALLER_HEADER, caller);
    return app.request(path, { ...init, headers });
  };
});
