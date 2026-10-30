import test from "node:test";
import assert from "node:assert/strict";

import worker, { Room } from "../worker/src/index.js";

test("health endpoint identifies the Worker as an unimplemented scaffold", async () => {
  const response = await worker.fetch(new Request("https://example.test/health"));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "scaffold", ready: false });
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("room routes fail closed until authentication and multiplayer are implemented", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/v1/rooms/ABC123/ws", {
      headers: { Upgrade: "websocket" },
    }),
  );

  assert.equal(response.status, 501);
  assert.deepEqual(await response.json(), {
    error: "multiplayer_not_implemented",
  });
});

test("Durable Object scaffold does not accept unauthenticated room traffic", async () => {
  const room = new Room();
  const response = await room.fetch(
    new Request("https://example.test/", {
      headers: { Upgrade: "websocket" },
    }),
  );

  assert.equal(response.status, 501);
  assert.deepEqual(await response.json(), { error: "room_not_implemented" });
});
