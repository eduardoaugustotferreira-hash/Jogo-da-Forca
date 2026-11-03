import test from "node:test";
import assert from "node:assert/strict";

import worker, { Room } from "../worker/src/index.js";

test("health endpoint reports Worker bindings without exposing secrets", async () => {
  const response = await worker.fetch(new Request("https://example.test/health"));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", ready: false });
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("room API requires authentication and does not trust client identity", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/v1/rooms", {
      method: "POST",
      headers: {
        Origin: "https://example.test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userId: "forged", characterId: "knight" }),
    }),
    { PUBLIC_ORIGIN: "https://example.test" },
  );

  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "rooms_unavailable");
});

test("Durable Object rejects unknown internal routes", async () => {
  const room = new Room();
  const response = await room.fetch(
    new Request("https://example.test/"),
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "not_found" });
});
