import {
  applyD1Migrations,
  createExecutionContext,
  createScheduledController,
  env,
  reset,
  waitOnExecutionContext,
} from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { ModelVersionSchema } from "@eadwyn/shared-protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Call, edgeContract } from "../../src/__tests__/contract";
import worker from "../../src/worker";

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
afterEach(async () => {
  await reset();
});

const call: Call = (path, init = {}, caller = "public") => {
  const request = new Request(`https://edge.test${path}`, init);
  return caller === "internal"
    ? exports.InternalApi.fetch(request)
    : exports.default.fetch(request);
};

edgeContract(async () => ({
  call,
  initialVersion: "0.1.0",
  publishedVersion: "0.2.0",
  backend: "upstream",
  operatorToken: "operator-token-0123456789",
}));

describe("cron sync", () => {
  it("adopts the published version from the scheduled handler", async () => {
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ cron: "*/5 * * * *" }), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(ModelVersionSchema.parse(await (await call("/v1/model")).json()).version).toBe("0.2.0");
  });
});
