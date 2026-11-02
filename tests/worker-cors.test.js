import test from "node:test";
import assert from "node:assert/strict";

import worker from "../worker/src/index.js";

const previewOrigin = "https://preview.a-forca-medieval.pages.dev";
const env = { ALLOWED_ORIGINS: previewOrigin };

test("health allows CORS only for the exact configured preview origin", async () => {
  const allowedResponse = await worker.fetch(
    new Request("https://api.example.test/health", {
      headers: { Origin: previewOrigin },
    }),
    env,
  );
  const deniedResponse = await worker.fetch(
    new Request("https://api.example.test/health", {
      headers: { Origin: "https://a-forca-medieval.pages.dev" },
    }),
    env,
  );

  assert.equal(allowedResponse.headers.get("access-control-allow-origin"), previewOrigin);
  assert.equal(allowedResponse.headers.get("access-control-allow-credentials"), null);
  assert.equal(allowedResponse.headers.get("vary"), "Origin");
  assert.equal(deniedResponse.headers.get("access-control-allow-origin"), null);
});

test("health preflight permits only GET from the configured preview origin", async () => {
  const response = await worker.fetch(
    new Request("https://api.example.test/health", {
      method: "OPTIONS",
      headers: {
        Origin: previewOrigin,
        "Access-Control-Request-Method": "GET",
      },
    }),
    env,
  );

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), previewOrigin);
  assert.equal(response.headers.get("access-control-allow-methods"), "GET, OPTIONS");
  assert.equal(response.headers.get("access-control-allow-credentials"), null);
});

test("CORS preflight rejects other origins, methods, headers, and room endpoints", async () => {
  const requests = [
    new Request("https://api.example.test/health", {
      method: "OPTIONS",
      headers: {
        Origin: "https://a-forca-medieval.pages.dev",
        "Access-Control-Request-Method": "GET",
      },
    }),
    new Request("https://api.example.test/health", {
      method: "OPTIONS",
      headers: {
        Origin: previewOrigin,
        "Access-Control-Request-Method": "POST",
      },
    }),
    new Request("https://api.example.test/health", {
      method: "OPTIONS",
      headers: {
        Origin: previewOrigin,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
      },
    }),
    new Request("https://api.example.test/v1/rooms/ABC123", {
      method: "OPTIONS",
      headers: {
        Origin: previewOrigin,
        "Access-Control-Request-Method": "POST",
      },
    }),
  ];

  for (const request of requests) {
    const response = await worker.fetch(request, env);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  }
});
