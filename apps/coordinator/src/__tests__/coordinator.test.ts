import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModelRegistry } from "@eadwyn/model-registry";
import { createLogger } from "@eadwyn/service-kit";
import {
  FederationStatsSchema,
  PublishModelResponseSchema,
  RegisterNodeResponseSchema,
} from "@eadwyn/shared-protocol";
import { FIXTURE_IDS, FIXTURE_PUBLIC_KEY } from "@eadwyn/shared-protocol/fixtures";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCoordinatorApp } from "../app";
import { createCoordinatorStore } from "../state";

let dir: string;
let app: ReturnType<typeof createCoordinatorApp>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "eadwyn-coordinator-"));
  app = createCoordinatorApp({
    store: createCoordinatorStore(join(dir, "coordinator.json")),
    registry: createModelRegistry({ filePath: join(dir, "model-registry.json") }),
    logger: createLogger({ service: "coordinator-test", level: "error" }),
    config: { expectedNodes: 128, onlineWindowMinutes: 360 },
  });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const postJson = (path: string, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("GET /v1/stats", () => {
  it("returns a valid federation readout from the seed", async () => {
    const res = await app.request("/v1/stats");
    expect(res.status).toBe(200);
    const stats = FederationStatsSchema.parse(await res.json());
    expect(stats.globalModelVersion).toBe("0.3.1");
    expect(stats.activeRound.number).toBe(41);
    expect(stats.activeRound.updatesReceived).toBe(96);
    expect(stats.registeredNodes).toBe(128);
    expect(stats.onlineNodes).toBe(71);
    expect(stats.lastSyncAt).not.toBeNull();
  });
});

describe("node registration", () => {
  it("registers a new node, is idempotent on the public key, and rejects bad payloads", async () => {
    const body = {
      displayName: "Test laptop",
      role: "home",
      publicKey: "MCowBQYDK2VwAyEA".concat("A".repeat(43), "="),
      capabilities: { compute: "cpu" },
    };
    const created = await postJson("/v1/nodes/register", body);
    expect(created.status).toBe(201);
    const first = RegisterNodeResponseSchema.parse(await created.json());
    expect(first.activeRound.number).toBe(41);

    const again = await postJson("/v1/nodes/register", { ...body, displayName: "Renamed" });
    expect(again.status).toBe(200);
    const second = RegisterNodeResponseSchema.parse(await again.json());
    expect(second.node.nodeId).toBe(first.node.nodeId);
    expect(second.node.displayName).toBe("Renamed");

    const stats = FederationStatsSchema.parse(await (await app.request("/v1/stats")).json());
    expect(stats.registeredNodes).toBe(129);

    const invalid = await postJson("/v1/nodes/register", { ...body, publicKey: "not base64!" });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: "invalid_payload" } });
  });
});

describe("publishing a merge", () => {
  it("bumps the global version, closes the round and opens the next one", async () => {
    const res = await postJson("/v1/model/publish", {
      candidateId: FIXTURE_IDS.candidate,
      roundId: FIXTURE_IDS.round,
      parentVersion: "0.3.1",
      checkpoint: { uri: "eadwyn://candidates/x", sha256: "a".repeat(64), bytes: 1024 },
      changelog: "Round 41 merge",
    });
    expect(res.status).toBe(201);
    const published = PublishModelResponseSchema.parse(await res.json());
    expect(published.model.version).toBe("0.4.0");
    expect(published.nextRound.number).toBe(42);
    expect(published.nextRound.baseModelVersion).toBe("0.4.0");

    const stats = FederationStatsSchema.parse(await (await app.request("/v1/stats")).json());
    expect(stats.globalModelVersion).toBe("0.4.0");
    expect(stats.activeRound.roundId).toBe(published.nextRound.roundId);

    const stale = await postJson("/v1/model/publish", {
      candidateId: FIXTURE_IDS.candidateAlt,
      roundId: FIXTURE_IDS.round,
      parentVersion: "0.3.1",
      checkpoint: { uri: "eadwyn://candidates/y", sha256: "b".repeat(64), bytes: 1024 },
      changelog: "stale",
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: "stale_parent" } });
  });

  it("tracks round progress reported by the aggregator", async () => {
    const res = await postJson("/v1/rounds/active/progress", {
      roundId: FIXTURE_IDS.round,
      nodeId: FIXTURE_IDS.node,
      updateId: "a1b2c3d4-0003-4000-8000-000000000999",
    });
    expect(res.status).toBe(200);
    const stats = FederationStatsSchema.parse(await (await app.request("/v1/stats")).json());
    expect(stats.activeRound.updatesReceived).toBe(97);
    expect(FIXTURE_PUBLIC_KEY.length).toBeGreaterThan(0);
  });
});
