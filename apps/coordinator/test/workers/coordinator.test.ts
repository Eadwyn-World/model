import { applyD1Migrations, env, reset } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { afterEach, beforeEach } from "vitest";
import { coordinatorContract } from "../../src/__tests__/contract";

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
afterEach(async () => {
  await reset();
});

// Public calls go through the default entrypoint; internal calls through the
// named InternalApi entrypoint, exactly as a service binding would reach it.
coordinatorContract(() => (path, init = {}, caller = "public") => {
  const request = new Request(`https://coordinator.test${path}`, init);
  return caller === "internal"
    ? exports.InternalApi.fetch(request)
    : exports.default.fetch(request);
});
