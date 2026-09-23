import { Hono } from "hono";
import { sign } from "hono/jwt";
import { describe, expect, it } from "vitest";
import { createAccessVerifier } from "../access";
import { createServiceApp } from "../app";
import { CALLER_HEADER, requireInternal, requireOperator, withCaller } from "../auth";
import { createLogger } from "../logger";
import { callerForNodeRequest } from "../node/server";

const logger = createLogger({ service: "test", level: "error" });

function app() {
  const service = createServiceApp({ name: "t", version: "0", description: "t", logger });
  service.post("/internal", requireInternal(), (c) => c.json({ ok: true }));
  service.post("/operator", requireOperator("s3cret"), (c) => c.json({ ok: true }));
  return service;
}

describe("caller stamping", () => {
  it("overrides whatever caller header the client sent", async () => {
    const forged = new Request("http://x/internal", {
      method: "POST",
      headers: { [CALLER_HEADER]: "internal" },
    });
    const res = await app().fetch(withCaller(forged, "public"));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "internal_only" } });
    expect((await app().fetch(withCaller(forged, "internal"))).status).toBe(200);
  });

  it("keeps the request body when re-stamping", async () => {
    const echo = new Hono();
    echo.post("/", async (c) =>
      c.json({ body: await c.req.json(), caller: c.req.header(CALLER_HEADER) }),
    );
    const request = new Request("http://x/", { method: "POST", body: JSON.stringify({ a: 1 }) });
    const res = await echo.fetch(withCaller(request, "public"));
    expect(await res.json()).toEqual({ body: { a: 1 }, caller: "public" });
  });

  it("trusts every Node caller only when no internal token is configured", () => {
    const plain = new Request("http://x/");
    const bearer = new Request("http://x/", { headers: { authorization: "Bearer tok" } });
    expect(callerForNodeRequest(plain, undefined)).toBe("internal");
    expect(callerForNodeRequest(plain, "tok")).toBe("public");
    expect(callerForNodeRequest(bearer, "tok")).toBe("internal");
    expect(callerForNodeRequest(bearer, "other")).toBe("public");
  });

  it("guards operator routes with the operator token", async () => {
    const service = app();
    const post = (headers: Record<string, string>) =>
      service.fetch(
        withCaller(new Request("http://x/operator", { method: "POST", headers }), "public"),
      );
    expect((await post({})).status).toBe(401);
    expect((await post({ authorization: "Bearer nope" })).status).toBe(403);
    expect((await post({ authorization: "Bearer s3cret" })).status).toBe(200);
  });
});

describe("Cloudflare Access verification", () => {
  it("accepts a token signed by the team key for the right audience only", async () => {
    const pair = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const publicJwk = {
      ...(await crypto.subtle.exportKey("jwk", pair.publicKey)),
      kid: "k1",
      alg: "RS256",
    };
    const privateJwk = {
      ...(await crypto.subtle.exportKey("jwk", pair.privateKey)),
      kid: "k1",
      alg: "RS256",
    };
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: "https://eadwyn.cloudflareaccess.com",
      aud: ["aud-tag"],
      email: "ash@eadwyn.world",
      sub: "user-1",
      iat: now,
      exp: now + 300,
    };
    const token = await sign(claims, privateJwk as never, "RS256");

    const verify = createAccessVerifier(
      { teamDomain: "eadwyn.cloudflareaccess.com", audience: "aud-tag" },
      { keys: [publicJwk] },
    );
    await expect(verify(token)).resolves.toMatchObject({
      id: "ash@eadwyn.world",
      email: "ash@eadwyn.world",
    });

    const wrongAudience = createAccessVerifier(
      { teamDomain: "eadwyn.cloudflareaccess.com", audience: "other" },
      { keys: [publicJwk] },
    );
    await expect(wrongAudience(token)).rejects.toThrow(/rejected/);

    const expired = await sign({ ...claims, exp: now - 10 }, privateJwk as never, "RS256");
    await expect(verify(expired)).rejects.toThrow(/rejected/);

    let fetched = 0;
    const viaCerts = createAccessVerifier(
      { teamDomain: "https://eadwyn.cloudflareaccess.com/", audience: "aud-tag" },
      {
        fetch: (async (input: RequestInfo | URL) => {
          fetched += 1;
          expect(String(input)).toBe("https://eadwyn.cloudflareaccess.com/cdn-cgi/access/certs");
          return Response.json({ keys: [publicJwk] });
        }) as typeof fetch,
      },
    );
    await viaCerts(token);
    await viaCerts(token);
    expect(fetched).toBe(1);
  });
});
