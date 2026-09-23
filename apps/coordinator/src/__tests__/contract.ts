/**
 * Coordinator contract: the behaviour both runtimes must share. Run against
 * the Node app (coordinator.test.ts) and the Cloudflare Worker
 * (test/workers/coordinator.test.ts), both seeded with the fixture world.
 */
import {
  FederationStatsSchema,
  HealthResponseSchema,
  PublishModelResponseSchema,
  RegisterNodeResponseSchema,
  RoundProgressResponseSchema,
} from "@eadwyn/shared-protocol";
import { FIXTURE_IDS } from "@eadwyn/shared-protocol/fixtures";
import { describe, expect, it } from "vitest";

export type Caller = "public" | "internal";
export type Call = (path: string, init?: RequestInit, caller?: Caller) => Promise<Response>;

const post = (call: Call, path: string, body: unknown, caller: Caller = "public") =>
  call(
    path,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    caller,
  );

const stats = async (call: Call) =>
  FederationStatsSchema.parse(await (await call("/v1/stats")).json());

const checkpoint = {
  uri: "store://checkpoints/rounds/r/candidates/c.safetensors",
  sha256: "a".repeat(64),
  bytes: 1024,
};

export function coordinatorContract(setup: () => Promise<Call> | Call) {
  describe("coordinator contract", () => {
    it("reports health and the fixture federation", async () => {
      const call = await setup();
      const health = HealthResponseSchema.parse(await (await call("/health")).json());
      expect(health).toMatchObject({ status: "ok", service: "coordinator" });
      const s = await stats(call);
      expect(s.globalModelVersion).toBe("0.3.1");
      expect(s.activeRound).toMatchObject({
        number: 41,
        updatesReceived: 96,
        status: "collecting",
      });
      expect(s.registeredNodes).toBe(128);
      expect(s.onlineNodes).toBe(71);
      expect(s.lastSyncAt).not.toBeNull();
    });

    it("registers nodes idempotently on their public key", async () => {
      const call = await setup();
      const body = {
        displayName: "Test laptop",
        role: "home",
        publicKey: "MCowBQYDK2VwAyEA".concat("A".repeat(43), "="),
        capabilities: { compute: "cpu" },
      };
      const created = await post(call, "/v1/nodes/register", body);
      expect(created.status).toBe(201);
      const first = RegisterNodeResponseSchema.parse(await created.json());
      expect(first.activeRound.number).toBe(41);

      const again = await post(call, "/v1/nodes/register", { ...body, displayName: "Renamed" });
      expect(again.status).toBe(200);
      const second = RegisterNodeResponseSchema.parse(await again.json());
      expect(second.node).toMatchObject({ nodeId: first.node.nodeId, displayName: "Renamed" });
      expect((await stats(call)).registeredNodes).toBe(129);

      const invalid = await post(call, "/v1/nodes/register", { ...body, publicKey: "not base64!" });
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toMatchObject({ error: { code: "invalid_payload" } });
    });

    it("publishes only for internal callers, idempotently per candidate, and rolls the round", async () => {
      const call = await setup();
      const request = {
        candidateId: FIXTURE_IDS.candidate,
        roundId: FIXTURE_IDS.round,
        parentVersion: "0.3.1",
        checkpoint,
        changelog: "Round 41 merge",
      };
      const outsider = await post(call, "/v1/model/publish", request, "public");
      expect(outsider.status).toBe(403);
      expect(await outsider.json()).toMatchObject({ error: { code: "internal_only" } });

      const res = await post(call, "/v1/model/publish", request, "internal");
      expect(res.status).toBe(201);
      const published = PublishModelResponseSchema.parse(await res.json());
      expect(published.model.version).toBe("0.4.0");
      expect(published.nextRound).toMatchObject({ number: 42, baseModelVersion: "0.4.0" });

      const replay = await post(call, "/v1/model/publish", request, "internal");
      expect(replay.status).toBe(200);
      const replayed = PublishModelResponseSchema.parse(await replay.json());
      expect(replayed.model.version).toBe("0.4.0");
      expect(replayed.nextRound.roundId).toBe(published.nextRound.roundId);

      const s = await stats(call);
      expect(s.globalModelVersion).toBe("0.4.0");
      expect(s.activeRound.roundId).toBe(published.nextRound.roundId);

      const stale = await post(
        call,
        "/v1/model/publish",
        { ...request, candidateId: FIXTURE_IDS.candidateAlt, changelog: "stale" },
        "internal",
      );
      expect(stale.status).toBe(409);
      expect(await stale.json()).toMatchObject({ error: { code: "stale_parent" } });
    });

    it("counts round progress once per node, from internal callers only", async () => {
      const call = await setup();
      const report = (nodeId: string, updateId: string, caller: Caller = "internal") =>
        post(
          call,
          "/v1/rounds/active/progress",
          { roundId: FIXTURE_IDS.round, nodeId, updateId },
          caller,
        );

      expect(
        (
          await report(
            "a1b2c3d4-0001-4000-8000-000000000100",
            "a1b2c3d4-0003-4000-8000-000000000999",
            "public",
          )
        ).status,
      ).toBe(403);

      const first = RoundProgressResponseSchema.parse(
        await (
          await report(
            "a1b2c3d4-0001-4000-8000-000000000100",
            "a1b2c3d4-0003-4000-8000-000000000999",
          )
        ).json(),
      );
      expect(first.round.updatesReceived).toBe(97);
      // Delivered twice (at-least-once queues): counted once.
      const repeat = RoundProgressResponseSchema.parse(
        await (
          await report(
            "a1b2c3d4-0001-4000-8000-000000000100",
            "a1b2c3d4-0003-4000-8000-000000000999",
          )
        ).json(),
      );
      expect(repeat.round.updatesReceived).toBe(97);

      const unknownNode = await report(
        "a1b2c3d4-0001-4000-8000-00000000ffff",
        "a1b2c3d4-0003-4000-8000-000000000998",
      );
      expect(unknownNode.status).toBe(404);

      // A report for a round that already closed (it travelled through a queue) still counts.
      const late = await post(
        call,
        "/v1/rounds/active/progress",
        {
          roundId: FIXTURE_IDS.previousRound,
          nodeId: "a1b2c3d4-0001-4000-8000-000000000100",
          updateId: "a1b2c3d4-0003-4000-8000-000000000997",
        },
        "internal",
      );
      expect(late.status).toBe(200);
      expect(RoundProgressResponseSchema.parse(await late.json()).round).toMatchObject({
        number: 40,
        status: "published",
        updatesReceived: 62,
      });
      const unknownRound = await post(
        call,
        "/v1/rounds/active/progress",
        {
          roundId: "a1b2c3d4-0002-4000-8000-00000000dead",
          nodeId: "a1b2c3d4-0001-4000-8000-000000000100",
          updateId: "a1b2c3d4-0003-4000-8000-000000000996",
        },
        "internal",
      );
      expect(unknownRound.status).toBe(404);
    });
  });
}
