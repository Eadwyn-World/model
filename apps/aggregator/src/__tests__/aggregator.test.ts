import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CALLER_HEADER, createLogger, createMemoryStore } from "@eadwyn/service-kit";
import { createFileObjectStore } from "@eadwyn/service-kit/node";
import { generateNodeKeyPair } from "@eadwyn/shared-protocol/signing";
import { afterEach } from "vitest";
import { createAggregatorApp } from "../app";
import { createInlineBackend } from "../backends";
import { runMergePipeline } from "../domain/pipeline";
import { createInProcessPipeline, createInProcessStepRunner } from "../node/pipeline-runner";
import { createDocumentRepository } from "../repository/document";
import { aggregatorCodec } from "../state";
import { type AggregatorHarness, aggregatorContract } from "./contract";

const logger = createLogger({ service: "aggregator-test", level: "error" });
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

aggregatorContract(async (): Promise<AggregatorHarness> => {
  const dir = await mkdtemp(join(tmpdir(), "eadwyn-aggregator-"));
  dirs.push(dir);
  const nodes = [
    { nodeId: crypto.randomUUID(), keys: await generateNodeKeyPair() },
    { nodeId: crypto.randomUUID(), keys: await generateNodeKeyPair() },
  ] as AggregatorHarness["nodes"];
  const repository = createDocumentRepository(createMemoryStore(aggregatorCodec("genesis")));
  const objectStore = createFileObjectStore(join(dir, "objects"));
  const forwarded: string[] = [];
  const reported: string[] = [];
  const pipeline = createInProcessPipeline({
    run: (id, step) =>
      runMergePipeline(
        {
          repository,
          backend: createInlineBackend(objectStore),
          governance: { submitCandidate: async (c) => void forwarded.push(c.candidateId) },
          now: () => new Date(),
        },
        id,
        step,
      ),
    logger,
    step: createInProcessStepRunner({ baseDelayMs: 1 }),
  });
  const app = createAggregatorApp({
    repository,
    objectStore,
    logger,
    verifySignatures: true,
    maxDeltaBytes: 1024 * 1024,
    now: () => new Date(),
    uploads: {
      maxDeltaBytes: 1024 * 1024,
      tokenSecret: "test-upload-secret-0123456789",
      ttlSeconds: 300,
    },
    resolvePublicKey: async (nodeId) =>
      nodes.find((n) => n.nodeId === nodeId)?.keys.publicKey ?? null,
    reportProgress: async (u) => void reported.push(u.updateId),
    pipeline,
    operatorToken: "operator-token-0123456789",
  });
  return {
    call: async (path, init = {}, caller = "public") => {
      const headers = new Headers(init.headers);
      headers.set(CALLER_HEADER, caller);
      return app.request(`http://aggregator.test${path}`, { ...init, headers });
    },
    nodes,
    roundId: crypto.randomUUID(),
    operatorToken: "operator-token-0123456789",
    settle: async (candidateId) => {
      await pipeline.idle();
      const found = await repository.getCandidate(candidateId);
      if (!found) throw new Error("candidate vanished");
      return found;
    },
    forwarded: async () => forwarded,
    progressReports: async () => reported,
  };
});
