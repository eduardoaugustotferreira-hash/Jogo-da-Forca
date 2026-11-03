import test from "node:test";
import assert from "node:assert/strict";

import { requestSession } from "../src/auth-session.js";

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test("anonymous session response is rendered as logged out, not an error", async () => {
  let request;
  const session = await requestSession({
    apiBaseUrl: "/api",
    fetchImpl: async (url, init) => {
      request = { url, init };
      return response({ authenticated: false, user: null });
    },
  });

  assert.deepEqual(session, { state: "anonymous" });
  assert.equal(request.url, "/api/auth/session");
  assert.equal(request.init.credentials, "same-origin");
  assert.equal(request.init.cache, "no-store");
  assert.equal(request.init.redirect, "error");
  assert.equal(request.init.headers.Accept, "application/json");
});

test("authenticated session returns only the display name for text rendering", async () => {
  const session = await requestSession({
    fetchImpl: async () =>
      response({
        authenticated: true,
        user: { displayName: "<Synthetic Player>" },
      }),
  });

  assert.deepEqual(session, {
    state: "authenticated",
    displayName: "<Synthetic Player>",
  });
});

test("non-success statuses are session errors rather than anonymous sessions", async () => {
  for (const status of [401, 403, 500, 503]) {
    await assert.rejects(
      requestSession({
        fetchImpl: async () => response({ error: "unavailable" }, status),
      }),
      /Session request failed/,
      `status ${status}`,
    );
  }
});

test("network failures and invalid JSON are reported as session errors", async () => {
  await assert.rejects(
    requestSession({
      fetchImpl: async () => {
        throw new TypeError("synthetic transport failure");
      },
    }),
    /synthetic transport failure/,
  );
  await assert.rejects(
    requestSession({
      fetchImpl: async () => ({
        ok: true,
        json: async () => {
          throw new SyntaxError("synthetic invalid JSON");
        },
      }),
    }),
    /synthetic invalid JSON/,
  );
});

test("unexpected JSON contracts are not mistaken for anonymous sessions", async () => {
  for (const body of [
    null,
    [],
    {},
    { authenticated: false },
    { authenticated: true, user: null },
    { authenticated: true, user: { displayName: " " } },
    { authenticated: "false", user: null },
  ]) {
    await assert.rejects(
      requestSession({ fetchImpl: async () => response(body) }),
      /Session response did not match the expected contract/,
      JSON.stringify(body),
    );
  }
});
