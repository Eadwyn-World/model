import { sampleFederationStats, sampleNodeIdentity } from "@eadwyn/shared-protocol/fixtures";
import { describe, expect, it } from "vitest";
import { createFederationClient, FederationApiError } from "../index";

function fakeFetch(handler: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("federation client", () => {
  it("fetches and validates federation stats", async () => {
    const stats = sampleFederationStats();
    const { fetchImpl, calls } = fakeFetch(() => json(stats));
    const client = createFederationClient({
      coordinatorUrl: "http://coordinator.test",
      fetch: fetchImpl,
    });

    await expect(client.coordinator.getStats()).resolves.toEqual(stats);
    expect(calls[0]?.url.toString()).toBe("http://coordinator.test/v1/stats");
  });

  it("surfaces the service error envelope", async () => {
    const { fetchImpl } = fakeFetch(() =>
      json({ error: { code: "unknown_node", message: "node is not registered" } }, 403),
    );
    const client = createFederationClient({
      coordinatorUrl: "http://coordinator.test",
      fetch: fetchImpl,
    });
    const error = await client.coordinator.getNode("missing").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FederationApiError);
    expect((error as FederationApiError).code).toBe("unknown_node");
    expect((error as FederationApiError).status).toBe(403);
  });

  it("rejects a response that drifts from the protocol", async () => {
    const { fetchImpl } = fakeFetch(() => json({ ...sampleNodeIdentity(), publicKey: 42 }));
    const client = createFederationClient({
      coordinatorUrl: "http://coordinator.test",
      fetch: fetchImpl,
    });
    await expect(client.coordinator.getNode("x")).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("posts JSON bodies and refuses unconfigured services", async () => {
    const { fetchImpl, calls } = fakeFetch(() => json({ error: { code: "x", message: "y" } }, 400));
    const client = createFederationClient({
      governanceUrl: "http://governance.test/",
      fetch: fetchImpl,
    });

    await client.governance
      .decide("cand", { reviewerId: "r", verdict: "approve", rationale: "ok" })
      .catch(() => undefined);
    expect(calls[0]?.url.toString()).toBe("http://governance.test/v1/merges/cand/decisions");
    expect(calls[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({ verdict: "approve" });

    await expect(client.coordinator.getStats()).rejects.toMatchObject({ code: "not_configured" });
  });
});
