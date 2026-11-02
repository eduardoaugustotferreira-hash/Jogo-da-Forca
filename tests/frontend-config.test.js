import test from "node:test";
import assert from "node:assert/strict";

import { createFrontendConfig } from "../scripts/frontend-config.js";

test("frontend config defaults to a local environment and relative API path", () => {
  assert.equal(
    createFrontendConfig(),
    'export const APP_ENV = "local";\nexport const API_BASE_URL = "/api";\n',
  );
});

test("frontend config uses the same relative API path in preview", () => {
  assert.equal(
    createFrontendConfig({ appEnv: "preview" }),
    'export const APP_ENV = "preview";\nexport const API_BASE_URL = "/api";\n',
  );
});

test("production frontend config does not embed the preview Worker URL", () => {
  assert.equal(
    createFrontendConfig({ appEnv: "production" }),
    'export const APP_ENV = "production";\nexport const API_BASE_URL = "/api";\n',
  );
});

test("frontend config rejects unsupported environments", () => {
  assert.throws(() => createFrontendConfig({ appEnv: "staging" }), /Unsupported/);
});
