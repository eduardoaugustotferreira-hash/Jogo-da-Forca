import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import worker from "../worker/src/index.js";
import { authConstants } from "../worker/src/auth.js";
import { onRequest as pagesProxy } from "../functions/api/[[path]].js";

const origin = "https://preview.a-forca-medieval.pages.dev";
const googleRedirectUri = `${origin}/api/auth/google/callback`;
const githubRedirectUri = `${origin}/api/auth/github/callback`;
const syntheticTransactionKey = Buffer.alloc(32, 7).toString("base64");
const initialMigration = await readFile(
  new URL("../worker/migrations/0001_initial.sql", import.meta.url),
  "utf8",
);
const wordMigration = await readFile(
  new URL("../worker/migrations/0002_word_entries.sql", import.meta.url),
  "utf8",
);
const oauthMigration = await readFile(
  new URL("../worker/migrations/0003_oauth_transactions.sql", import.meta.url),
  "utf8",
);
const signingPair = await crypto.subtle.generateKey(
  {
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  },
  true,
  ["sign", "verify"],
);
const publicJwk = {
  ...(await crypto.subtle.exportKey("jwk", signingPair.publicKey)),
  alg: "RS256",
  kid: "synthetic-google-key",
  use: "sig",
};

function createDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(initialMigration);
  sqlite.exec(wordMigration);
  sqlite.exec(oauthMigration);
  return new D1Database(sqlite);
}

class D1Statement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new D1Statement(this.database, this.sql, values);
  }

  first() {
    return this.database.prepare(this.sql).get(...this.values) ?? null;
  }

  all() {
    return { results: this.database.prepare(this.sql).all(...this.values) };
  }

  run() {
    return this.database.prepare(this.sql).run(...this.values);
  }
}

class D1Database {
  constructor(sqlite) {
    this.sqlite = sqlite;
  }

  prepare(sql) {
    return new D1Statement(this.sqlite, sql);
  }

  batch(statements) {
    this.sqlite.exec("BEGIN");
    try {
      const results = statements.map((statement) =>
        this.sqlite.prepare(statement.sql).run(...statement.values),
      );
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

async function signedGoogleToken(claimOverrides = {}, signatureOverride) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", kid: publicJwk.kid }));
  const claims = base64Url(
    JSON.stringify({
      iss: "https://accounts.google.com",
      aud: "synthetic-google-client",
      sub: "google-subject-1",
      iat: now,
      exp: now + 300,
      nonce: "unused-test-nonce",
      email: "shared@example.test",
      email_verified: true,
      name: "Cavaleiro Sintético",
      ...claimOverrides,
    }),
  );
  const signed = `${header}.${claims}`;
  const signature =
    signatureOverride ??
    Buffer.from(
      await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        signingPair.privateKey,
        new TextEncoder().encode(signed),
      ),
    ).toString("base64url");
  return `${signed}.${signature}`;
}

function createEnv(database = createDatabase(), overrides = {}) {
  const env = {
    APP_ENV: "preview",
    PUBLIC_ORIGIN: origin,
    GOOGLE_REDIRECT_URI: googleRedirectUri,
    GITHUB_REDIRECT_URI: githubRedirectUri,
    GOOGLE_CLIENT_ID: "synthetic-google-client",
    GOOGLE_CLIENT_SECRET: "synthetic-google-secret",
    GITHUB_CLIENT_ID: "synthetic-github-client",
    GITHUB_CLIENT_SECRET: "synthetic-github-secret",
    OAUTH_TRANSACTION_KEY: syntheticTransactionKey,
    DB: database,
    googleToken: null,
    githubProfile: {
      id: 725001,
      login: "synthetic-player",
      name: "Jogador Sintético",
      email: "shared@example.test",
    },
    validPkceVerifier: null,
    OAUTH_FETCH: async (input, init = {}) => {
      const url = new URL(input);
      if (url.href === "https://oauth2.googleapis.com/token") {
        const form = new URLSearchParams(init.body);
        if (
          form.get("code_verifier") !== env.validPkceVerifier ||
          form.get("redirect_uri") !== googleRedirectUri
        ) {
          return Response.json({ error: "invalid_grant" }, { status: 400 });
        }
        return Response.json({
          access_token: "synthetic-google-access-token",
          id_token: env.googleToken,
        });
      }
      if (url.href === "https://www.googleapis.com/oauth2/v3/certs") {
        return Response.json({ keys: [publicJwk] });
      }
      if (url.href === "https://github.com/login/oauth/access_token") {
        const form = new URLSearchParams(init.body);
        if (
          form.get("code_verifier") !== env.validPkceVerifier ||
          form.get("redirect_uri") !== githubRedirectUri
        ) {
          return Response.json({ error: "invalid_grant" }, { status: 400 });
        }
        return Response.json({ access_token: "synthetic-github-access-token" });
      }
      if (url.href === "https://api.github.com/user") {
        assert.equal(
          new Headers(init.headers).get("authorization"),
          "Bearer synthetic-github-access-token",
        );
        return Response.json(env.githubProfile);
      }
      throw new Error("Unexpected synthetic provider request.");
    },
    ...overrides,
  };
  return env;
}

async function startLogin(env, provider = "google", query = "") {
  const response = await worker.fetch(
    new Request(`${origin}/auth/${provider}/start${query}`),
    env,
  );
  const location = new URL(response.headers.get("location"));
  const oauthCookie = response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith(`${authConstants.OAUTH_COOKIE}=`));
  assert.ok(oauthCookie);
  const binding = oauthCookie.split(";", 1)[0].split("=")[1];
  const stateHash = await hash(location.searchParams.get("state"));
  const transaction = env.DB
    .prepare("SELECT * FROM oauth_transactions WHERE state_hash = ?")
    .bind(stateHash)
    .first();
  env.validPkceVerifier = await decryptVerifier(transaction, provider);
  if (provider === "google") {
    env.googleToken = await signedGoogleToken({
      nonce: location.searchParams.get("nonce"),
    });
  }
  return {
    response,
    location,
    state: location.searchParams.get("state"),
    binding,
    transaction,
  };
}

async function decryptVerifier(transaction, provider) {
  const key = await crypto.subtle.importKey(
    "raw",
    Buffer.from(syntheticTransactionKey, "base64"),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const combined = Buffer.from(
    transaction.pkce_verifier_ciphertext,
    "base64url",
  );
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: combined.subarray(0, 12),
      additionalData: new TextEncoder().encode(
        `${transaction.state_hash}:${provider}`,
      ),
    },
    key,
    combined.subarray(12),
  );
  return new TextDecoder().decode(plaintext);
}

async function hash(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function callbackRequest(provider, state, binding, options = {}) {
  const query = new URLSearchParams();
  if (options.error) {
    query.set("error", options.error);
  } else {
    query.set("code", options.code ?? "synthetic-authorization-code");
  }
  if (state !== null) {
    query.set("state", state);
  }
  const url = `${origin}/auth/${provider}/callback?${query}`;
  return new Request(url, {
    headers: binding
      ? { Cookie: `${authConstants.OAUTH_COOKIE}=${binding}` }
      : {},
  });
}

function sessionCookie(response) {
  const cookie = response
    .headers.getSetCookie()
    .find((value) => value.startsWith(`${authConstants.SESSION_COOKIE}=`));
  assert.ok(cookie);
  return cookie;
}

function sessionCookieValue(cookie) {
  return cookie.split(";", 1)[0].slice(authConstants.SESSION_COOKIE.length + 1);
}

test("Google Authorization Code + PKCE creates an HttpOnly host-only session", async () => {
  const env = createEnv();
  const { response, location, state, binding, transaction } = await startLogin(
    env,
    "google",
    "?return_to=https%3A%2F%2Fattacker.example",
  );
  assert.equal(response.status, 302);
  assert.equal(location.origin, "https://accounts.google.com");
  assert.equal(location.searchParams.get("code_challenge_method"), "S256");
  assert.equal(location.searchParams.get("redirect_uri"), googleRedirectUri);
  assert.equal(
    location.searchParams.get("code_challenge"),
    Buffer.from(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(await decryptVerifier(transaction, "google")),
      ),
    ).toString("base64url"),
  );
  assert.equal(location.searchParams.has("return_to"), false);
  assert.match(
    response.headers.get("set-cookie"),
    /__Host-afm_oauth=.*; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=600/,
  );

  const callback = await worker.fetch(
    callbackRequest("google", state, binding),
    env,
  );
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get("location"), `${origin}/`);
  const cookie = sessionCookie(callback);
  assert.match(cookie, /; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=604800/);
  assert.doesNotMatch(cookie, /Domain=/i);
  const sessionId = sessionCookieValue(cookie);
  const storedSession = env.DB
    .prepare("SELECT id_hash, expires_at FROM sessions")
    .first();
  assert.equal(storedSession.id_hash, await hash(sessionId));
  assert.notEqual(storedSession.id_hash, sessionId);

  const session = await worker.fetch(
    new Request(`${origin}/auth/session`, {
      headers: { Cookie: `${authConstants.SESSION_COOKIE}=${sessionId}` },
    }),
    env,
  );
  assert.deepEqual(await session.json(), {
    authenticated: true,
    user: { displayName: "Cavaleiro Sintético" },
  });
});

test("same-origin Pages proxy preserves OAuth redirects and both host-only cookies", async () => {
  const env = createEnv();
  const proxyEnv = {
    API: {
      fetch: (request) => worker.fetch(request, env),
    },
    PUBLIC_ORIGIN: origin,
  };
  const start = await pagesProxy({
    request: new Request(`${origin}/api/auth/google/start`),
    env: proxyEnv,
  });
  assert.equal(start.status, 302);
  const providerUrl = new URL(start.headers.get("location"));
  const bindingCookie = start.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith(`${authConstants.OAUTH_COOKIE}=`));
  assert.ok(bindingCookie);
  assert.doesNotMatch(bindingCookie, /Domain=/i);
  const binding = bindingCookie.split(";", 1)[0].split("=")[1];
  const state = providerUrl.searchParams.get("state");
  const transaction = env.DB
    .prepare("SELECT * FROM oauth_transactions WHERE state_hash = ?")
    .bind(await hash(state))
    .first();
  assert.ok(transaction);
  env.validPkceVerifier = await decryptVerifier(transaction, "google");
  assert.notEqual(transaction.nonce_hash, providerUrl.searchParams.get("nonce"));
  env.googleToken = await signedGoogleToken({
    nonce: providerUrl.searchParams.get("nonce"),
  });

  const callback = await pagesProxy({
    request: new Request(
      `${origin}/api/auth/google/callback?state=${encodeURIComponent(state)}&code=synthetic-code`,
      { headers: { Cookie: `${authConstants.OAUTH_COOKIE}=${binding}` } },
    ),
    env: proxyEnv,
  });
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get("location"), `${origin}/`);
  const cookies = callback.headers.getSetCookie();
  assert.equal(cookies.length, 2);
  assert.ok(cookies.some((cookie) => cookie.startsWith(`${authConstants.SESSION_COOKIE}=`)));
  assert.ok(cookies.some((cookie) => cookie.startsWith(`${authConstants.OAUTH_COOKIE}=`)));
  assert.ok(cookies.every((cookie) => !/Domain=/i.test(cookie)));
  assert.equal(
    env.DB
      .prepare("SELECT pkce_verifier_ciphertext FROM oauth_transactions WHERE state_hash = ?")
      .bind(await hash(state))
      .first(),
    null,
  );
});

test("state cannot be reused, expired, or completed from another browser", async () => {
  const env = createEnv();
  const login = await startLogin(env);
  const wrongBrowser = await worker.fetch(
    callbackRequest("google", login.state, "different-browser-binding"),
    env,
  );
  assert.equal(wrongBrowser.status, 400);
  assert.equal(
    env.DB.prepare("SELECT COUNT(*) AS count FROM oauth_transactions").first().count,
    1,
  );

  const expired = await startLogin(env, "github");
  env.DB
    .prepare(
      "UPDATE oauth_transactions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE state_hash = ?",
    )
    .bind(await hash(expired.state))
    .run();
  const expiredResponse = await worker.fetch(
    callbackRequest("github", expired.state, expired.binding),
    env,
  );
  assert.equal(expiredResponse.status, 400);

  env.validPkceVerifier = await decryptVerifier(login.transaction, "google");
  const valid = await worker.fetch(
    callbackRequest("google", login.state, login.binding),
    env,
  );
  assert.equal(valid.status, 302);
  const replay = await worker.fetch(
    callbackRequest("google", login.state, login.binding),
    env,
  );
  assert.equal(replay.status, 400);
  assert.deepEqual(await replay.json(), { error: "invalid_oauth_state" });
});

test("PKCE verifier mismatch is rejected and does not create a session", async () => {
  const env = createEnv();
  const { state, binding } = await startLogin(env);
  env.validPkceVerifier = "a-different-verifier";
  const response = await worker.fetch(
    callbackRequest("google", state, binding),
    env,
  );
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: "identity_provider_unavailable",
  });
  assert.equal(env.DB.prepare("SELECT COUNT(*) AS count FROM sessions").first().count, 0);
});

test("tampered encrypted PKCE verifier is rejected before contacting the provider", async () => {
  const env = createEnv();
  const login = await startLogin(env);
  env.DB
    .prepare(
      "UPDATE oauth_transactions SET pkce_verifier_ciphertext = ? WHERE state_hash = ?",
    )
    .bind("A".repeat(100), await hash(login.state))
    .run();
  const response = await worker.fetch(
    callbackRequest("google", login.state, login.binding),
    env,
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "invalid_oauth_state",
  });
  assert.equal(env.DB.prepare("SELECT COUNT(*) AS count FROM sessions").first().count, 0);
});

test("concurrent callbacks consume an OAuth state exactly once", async () => {
  const env = createEnv();
  const login = await startLogin(env);
  const responses = await Promise.all([
    worker.fetch(callbackRequest("google", login.state, login.binding), env),
    worker.fetch(callbackRequest("google", login.state, login.binding), env),
  ]);
  assert.deepEqual(
    responses.map(({ status }) => status).sort(),
    [302, 400],
  );
  assert.equal(env.DB.prepare("SELECT COUNT(*) AS count FROM sessions").first().count, 1);
});

test("Google rejects invalid issuer, audience, nonce, and signature", async () => {
  for (const claims of [
    { iss: "https://attacker.example" },
    { aud: "wrong-client" },
    { nonce: "wrong-nonce" },
    { azp: "wrong-client" },
    { exp: Math.floor(Date.now() / 1000) - 1 },
    { iat: Math.floor(Date.now() / 1000) + 120 },
  ]) {
    const env = createEnv();
    const login = await startLogin(env);
    env.googleToken = await signedGoogleToken({
      nonce: login.location.searchParams.get("nonce"),
      ...claims,
    });
    const response = await worker.fetch(
      callbackRequest("google", login.state, login.binding),
      env,
    );
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "invalid_identity_token" });
  }

  const env = createEnv();
  const login = await startLogin(env);
  env.googleToken = await signedGoogleToken(
    { nonce: login.location.searchParams.get("nonce") },
    Buffer.from("invalid-signature").toString("base64url"),
  );
  const response = await worker.fetch(
    callbackRequest("google", login.state, login.binding),
    env,
  );
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "invalid_identity_token" });
});

test("GitHub uses immutable provider ID and same-email providers create separate accounts", async () => {
  const env = createEnv();
  const google = await startLogin(env, "google");
  const googleCallback = await worker.fetch(
    callbackRequest("google", google.state, google.binding),
    env,
  );
  assert.equal(googleCallback.status, 302);

  const github = await startLogin(env, "github");
  assert.equal(github.location.origin, "https://github.com");
  assert.equal(github.location.searchParams.get("code_challenge_method"), "S256");
  assert.equal(github.location.searchParams.get("scope"), "read:user");
  const githubCallback = await worker.fetch(
    callbackRequest("github", github.state, github.binding),
    env,
  );
  assert.equal(githubCallback.status, 302);

  assert.equal(env.DB.prepare("SELECT COUNT(*) AS count FROM users").first().count, 2);
  const identities = env.DB
    .prepare(
      "SELECT provider, provider_subject, email, email_verified FROM provider_identities ORDER BY provider",
    )
    .all().results;
  assert.deepEqual(
    identities.map(({ provider, provider_subject }) => [provider, provider_subject]),
    [
      ["github", "725001"],
      ["google", "google-subject-1"],
    ],
  );
  assert.equal(identities.find(({ provider }) => provider === "github").email, null);

  env.githubProfile = {
    id: 725001,
    login: "renamed-synthetic-player",
    name: "Nome atualizado pelo provedor",
    email: "different@example.test",
  };
  const sameGithubAccount = await startLogin(env, "github");
  const sameGithubCallback = await worker.fetch(
    callbackRequest("github", sameGithubAccount.state, sameGithubAccount.binding),
    env,
  );
  assert.equal(sameGithubCallback.status, 302);
  assert.equal(env.DB.prepare("SELECT COUNT(*) AS count FROM users").first().count, 2);
  assert.equal(
    env.DB.prepare("SELECT COUNT(*) AS count FROM provider_identities WHERE provider = 'github'").first().count,
    1,
  );
});

test("session expiry, revocation, direct Worker origin, and logout CSRF are enforced", async () => {
  const env = createEnv();
  const login = await startLogin(env);
  const callback = await worker.fetch(
    callbackRequest("google", login.state, login.binding),
    env,
  );
  const sessionId = sessionCookieValue(sessionCookie(callback));
  const sessionHash = await hash(sessionId);

  const directWorker = await worker.fetch(
    new Request("https://a-forca-medieval-api-preview.example.workers.dev/auth/session", {
      headers: { Cookie: `${authConstants.SESSION_COOKIE}=${sessionId}` },
    }),
    env,
  );
  assert.equal(directWorker.status, 404);

  const badOriginLogout = await worker.fetch(
    new Request(`${origin}/auth/logout`, {
      method: "POST",
      headers: {
        Origin: "https://attacker.example",
        "Content-Type": "application/json",
        Cookie: `${authConstants.SESSION_COOKIE}=${sessionId}`,
      },
      body: "{}",
    }),
    env,
  );
  assert.equal(badOriginLogout.status, 403);

  const logout = await worker.fetch(
    new Request(`${origin}/auth/logout`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        Cookie: `${authConstants.SESSION_COOKIE}=${sessionId}`,
      },
      body: "{}",
    }),
    env,
  );
  assert.equal(logout.status, 200);
  assert.match(
    logout.headers.getSetCookie().find((cookie) => cookie.startsWith(`${authConstants.SESSION_COOKIE}=`)),
    /Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT/,
  );
  assert.ok(
    env.DB.prepare("SELECT revoked_at FROM sessions WHERE id_hash = ?")
      .bind(sessionHash)
      .first().revoked_at,
  );
  const afterLogout = await worker.fetch(
    new Request(`${origin}/auth/session`, {
      headers: { Cookie: `${authConstants.SESSION_COOKIE}=${sessionId}` },
    }),
    env,
  );
  assert.deepEqual(await afterLogout.json(), { authenticated: false, user: null });

  env.DB
    .prepare("UPDATE sessions SET revoked_at = NULL, expires_at = ? WHERE id_hash = ?")
    .bind("2000-01-01T00:00:00.000Z", sessionHash)
    .run();
  const expired = await worker.fetch(
    new Request(`${origin}/auth/session`, {
      headers: { Cookie: `${authConstants.SESSION_COOKIE}=${sessionId}` },
    }),
    env,
  );
  assert.deepEqual(await expired.json(), { authenticated: false, user: null });
});

test("missing credentials, malformed methods, and provider errors fail closed", async () => {
  const unconfigured = createEnv(undefined, {
    GOOGLE_CLIENT_ID: undefined,
    GOOGLE_CLIENT_SECRET: undefined,
  });
  const start = await worker.fetch(
    new Request(`${origin}/auth/google/start`),
    unconfigured,
  );
  assert.equal(start.status, 503);
  assert.deepEqual(await start.json(), { error: "oauth_provider_not_configured" });

  const env = createEnv();
  const method = await worker.fetch(
    new Request(`${origin}/auth/logout`, { method: "GET" }),
    env,
  );
  assert.equal(method.status, 405);

  const login = await startLogin(env, "github");
  const denied = await worker.fetch(
    callbackRequest("github", login.state, login.binding, {
      error: "access_denied",
    }),
    env,
  );
  assert.equal(denied.status, 400);
  assert.deepEqual(await denied.json(), { error: "oauth_authorization_denied" });
  assert.equal(
    denied.headers.getSetCookie().some((cookie) => cookie.startsWith(`${authConstants.OAUTH_COOKIE}=`)),
    true,
  );

  const duplicateState = await startLogin(env, "github");
  const ambiguous = await worker.fetch(
    new Request(
      `${origin}/auth/github/callback?state=${duplicateState.state}&state=attacker&code=synthetic`,
      {
        headers: {
          Cookie: `${authConstants.OAUTH_COOKIE}=${duplicateState.binding}`,
        },
      },
    ),
    env,
  );
  assert.equal(ambiguous.status, 400);
});

test("OAuth transaction encryption requires a valid server-side key", async () => {
  const env = createEnv(undefined, { OAUTH_TRANSACTION_KEY: undefined });
  const response = await worker.fetch(
    new Request(`${origin}/auth/google/start`),
    env,
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "authentication_not_configured",
  });
  assert.equal(
    env.DB.prepare("SELECT COUNT(*) AS count FROM oauth_transactions").first().count,
    0,
  );
});

test("public frontend contains no OAuth credentials or provider tokens", async () => {
  const files = [
    "../index.html",
    "../src/main.js",
    "../src/config.js",
    "../scripts/build-pages.mjs",
  ];
  for (const relativePath of files) {
    const content = await readFile(
      new URL(relativePath, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(
      content,
      /GOOGLE_CLIENT_SECRET|GITHUB_CLIENT_SECRET|access_token|id_token|client_secret/i,
      relativePath,
    );
  }

  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /href="\/api\/auth\/google\/start"/);
  assert.match(html, /href="\/api\/auth\/github\/start"/);
  assert.doesNotMatch(html, /workers\.dev|client_secret|access_token|id_token/i);
});

test("OAuth migration is forward-only and adds short-lived transaction storage", () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec(initialMigration);
    sqlite.exec(oauthMigration);
    const columns = sqlite
      .prepare("PRAGMA table_info(oauth_transactions)")
      .all()
      .map(({ name }) => name);
    assert.deepEqual(columns, [
      "state_hash",
      "browser_binding_hash",
      "provider",
      "pkce_verifier_ciphertext",
      "nonce_hash",
      "redirect_uri",
      "expires_at",
      "created_at",
    ]);
    assert.ok(
      sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'oauth_transactions_expires_at_idx'",
        )
        .get(),
    );
    assert.throws(() =>
      sqlite
        .prepare(
          `INSERT INTO oauth_transactions (
            state_hash, browser_binding_hash, provider,
            pkce_verifier_ciphertext, nonce_hash, redirect_uri, expires_at
          ) VALUES (?, ?, 'google', ?, NULL, ?, ?)`,
        )
        .run("a".repeat(64), "b".repeat(64), "A".repeat(100), googleRedirectUri, "2099-01-01T00:00:00.000Z"),
    );
  } finally {
    sqlite.close();
  }
});
