import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { onRequest } from "../functions/api/[[path]].js";

const publicOrigin = "https://preview.a-forca-medieval.pages.dev";

function context(request, fetch, overrides = {}) {
  return {
    request,
    env: {
      API: { fetch },
      PUBLIC_ORIGIN: publicOrigin,
      ...overrides,
    },
  };
}

test("GET proxy preserves API path, query, origin and strips untrusted forwarding headers", async () => {
  let forwarded;
  const response = await onRequest(
    context(
      new Request(`${publicOrigin}/api/health?detail=full&x=1`, {
        headers: {
          Origin: publicOrigin,
          "X-Forwarded-Host": "attacker.example",
          "X-Forwarded-Proto": "http",
        },
      }),
      async (request) => {
        forwarded = request;
        return Response.json({ status: "ok" });
      },
    ),
  );

  assert.equal(response.status, 200);
  assert.equal(forwarded.method, "GET");
  assert.equal(forwarded.url, `${publicOrigin}/health?detail=full&x=1`);
  assert.equal(forwarded.headers.get("origin"), publicOrigin);
  assert.equal(forwarded.headers.get("x-forwarded-host"), null);
  assert.equal(forwarded.headers.get("x-forwarded-proto"), null);
});

test("POST proxy preserves body, cookie and content headers", async () => {
  let forwarded;
  const response = await onRequest(
    context(
      new Request(`${publicOrigin}/api/auth/logout?source=menu`, {
        method: "POST",
        headers: {
          Cookie: "__Host-afm_session=opaque",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ csrfToken: "synthetic" }),
      }),
      async (request) => {
        forwarded = request;
        return new Response(null, { status: 204 });
      },
    ),
  );

  assert.equal(response.status, 204);
  assert.equal(forwarded.method, "POST");
  assert.equal(forwarded.url, `${publicOrigin}/auth/logout?source=menu`);
  assert.equal(forwarded.headers.get("cookie"), "__Host-afm_session=opaque");
  assert.equal(forwarded.headers.get("content-type"), "application/json");
  assert.deepEqual(await forwarded.json(), { csrfToken: "synthetic" });
});

test("response cookies are host-only while other cookie attributes and duplicates survive", async () => {
  const response = await onRequest(
    context(
      new Request(`${publicOrigin}/api/auth/callback`),
      async () => {
        const headers = new Headers();
        headers.append(
          "Set-Cookie",
          "__Host-afm_session=opaque; Domain=workers.dev; Path=/; Secure; HttpOnly; SameSite=Lax",
        );
        headers.append("Set-Cookie", "csrf=opaque; Domain=example.test; Path=/; Secure");
        return new Response("ok", { headers });
      },
    ),
  );

  assert.deepEqual(response.headers.getSetCookie(), [
    "__Host-afm_session=opaque; Path=/; Secure; HttpOnly; SameSite=Lax",
    "csrf=opaque; Path=/; Secure",
  ]);
  assert.equal(response.headers.get("set-cookie").includes("Domain="), false);
});

test("OAuth redirects to fixed Pages and provider authorization endpoints are preserved", async () => {
  for (const location of [
    `${publicOrigin}/api/auth/session`,
    "https://accounts.google.com/o/oauth2/v2/auth?client_id=public",
    "https://github.com/login/oauth/authorize?client_id=public",
  ]) {
    const response = await onRequest(
      context(
        new Request(`${publicOrigin}/api/auth/start`),
        async () => new Response(null, { status: 302, headers: { Location: location } }),
      ),
    );

    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), location);
  }
});

test("rejects routes outside /api and unsafe path segments", async () => {
  let called = false;
  const fetch = async () => {
    called = true;
    return new Response("unexpected");
  };

  for (const path of [
    "/health",
    "/api",
    "/api//auth/session",
    "/api/%2e%2e/health",
    "/api/%2fhealth",
  ]) {
    const response = await onRequest(
      context(new Request(`${publicOrigin}${path}`), fetch),
    );
    assert.equal(response.status, 404, path);
  }

  assert.equal(called, false);
});

test("rejects unsupported methods and malformed WebSocket upgrades", async () => {
  let called = false;
  const fetch = async () => {
    called = true;
    return new Response("unexpected");
  };

  const traceRequest = new Request(`${publicOrigin}/api/health`);
  const trace = await onRequest(
    context(
      { ...traceRequest, method: "TRACE", url: traceRequest.url },
      fetch,
    ),
  );
  const invalidUpgrade = await onRequest(
    context(
      new Request(`${publicOrigin}/api/auth/session`, {
        headers: { Connection: "Upgrade", Upgrade: "websocket" },
      }),
      fetch,
    ),
  );

  assert.equal(trace.status, 405);
  assert.equal(invalidUpgrade.status, 400);
  assert.equal(called, false);
});

test("rejects unapproved redirect destinations", async () => {
  const response = await onRequest(
    context(
      new Request(`${publicOrigin}/api/auth/start`),
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: "https://attacker.example/steal" },
        }),
    ),
  );

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "api_redirect_not_allowed" });
});

test("returns explicit errors when the binding is missing or unavailable", async () => {
  const request = new Request(`${publicOrigin}/api/health`);
  const missing = await onRequest({
    request,
    env: { PUBLIC_ORIGIN: publicOrigin },
  });
  const unavailable = await onRequest(
    context(request, async () => {
      throw new Error("synthetic transport error");
    }),
  );

  assert.equal(missing.status, 503);
  assert.deepEqual(await missing.json(), { error: "api_service_unavailable" });
  assert.equal(unavailable.status, 502);
  assert.deepEqual(await unavailable.json(), { error: "api_service_unavailable" });
});

test("only Pages preview is bound to the preview Worker; production has no preview binding", async () => {
  const configuration = JSON.parse(
    await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
  );

  assert.equal(configuration.name, "a-forca-medieval");
  assert.deepEqual(configuration.services, []);
  assert.deepEqual(configuration.env.preview.services, [
    { binding: "API", service: "a-forca-medieval-api-preview" },
  ]);
  assert.deepEqual(configuration.env.production.services, []);
  assert.equal(configuration.env.preview.vars.PUBLIC_ORIGIN, publicOrigin);
  assert.equal(configuration.env.production.vars.APP_ENV, "production");
});

test("WebSocket upgrade is forwarded only for room routes without changing handshake headers", async () => {
  let forwarded;
  const request = new Request(`${publicOrigin}/api/v1/rooms/room1/ws?ticket=synthetic`, {
    headers: {
      Connection: "keep-alive, Upgrade",
      Upgrade: "websocket",
      Origin: publicOrigin,
      "Sec-WebSocket-Key": "synthetic-key",
      "Sec-WebSocket-Version": "13",
    },
  });
  const response = await onRequest(
    context(request, async (upstream) => {
      forwarded = upstream;
      return new Response(null, { status: 501 });
    }),
  );

  assert.equal(response.status, 501);
  assert.equal(forwarded.url, `${publicOrigin}/v1/rooms/room1/ws?ticket=synthetic`);
  assert.equal(forwarded.headers.get("upgrade"), "websocket");
  assert.equal(forwarded.headers.get("connection"), "Upgrade");
  assert.equal(forwarded.headers.get("sec-websocket-key"), "synthetic-key");
});
