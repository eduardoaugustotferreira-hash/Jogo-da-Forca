const OAUTH_TRANSACTION_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const SESSION_COOKIE = "__Host-afm_session";
const OAUTH_COOKIE = "__Host-afm_oauth";
const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const GITHUB_API_VERSION = "2022-11-28";
const SAFE_PROVIDER_ERROR_CODES = new Set([
  "invalid_client",
  "invalid_grant",
  "invalid_request",
  "unauthorized_client",
  "unsupported_grant_type",
]);
const SESSION_COOKIE_OPTIONS = "Path=/; Secure; HttpOnly; SameSite=Lax";
const OAUTH_COOKIE_OPTIONS = `${SESSION_COOKIE_OPTIONS}; Max-Age=600`;

class AuthError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function jsonResponse(body, status = 200, headers = {}) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Cache-Control", "no-store");
  return Response.json(body, {
    status,
    headers: responseHeaders,
  });
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlDecode(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function transactionKey(env) {
  if (
    typeof env.OAUTH_TRANSACTION_KEY !== "string" ||
    !/^[A-Za-z0-9+/]{43}=$/.test(env.OAUTH_TRANSACTION_KEY)
  ) {
    throw new AuthError(503, "authentication_not_configured");
  }

  let raw;
  try {
    raw = atob(env.OAUTH_TRANSACTION_KEY);
  } catch {
    throw new AuthError(503, "authentication_not_configured");
  }
  if (raw.length !== 32) {
    throw new AuthError(503, "authentication_not_configured");
  }
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

async function encryptVerifier(verifier, stateHash, provider, env) {
  const key = await crypto.subtle.importKey(
    "raw",
    transactionKey(env),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(`${stateHash}:${provider}`),
    },
    key,
    new TextEncoder().encode(verifier),
  );
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return base64UrlEncode(combined);
}

async function decryptVerifier(ciphertext, stateHash, provider, env) {
  let combined;
  try {
    if (!/^[A-Za-z0-9_-]{80,256}$/.test(ciphertext)) {
      throw new Error("Invalid encrypted verifier.");
    }
    combined = base64UrlDecode(ciphertext);
  } catch {
    throw new AuthError(400, "invalid_oauth_state");
  }
  if (combined.length <= 12 + 16) {
    throw new AuthError(400, "invalid_oauth_state");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    transactionKey(env),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: combined.slice(0, 12),
        additionalData: new TextEncoder().encode(`${stateHash}:${provider}`),
      },
      key,
      combined.slice(12),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new AuthError(400, "invalid_oauth_state");
  }
}

function randomToken(byteLength = 32) {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(byteLength)));
}

async function sha256(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function pkceChallenge(verifier) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64UrlEncode(new Uint8Array(digest));
}

function cookieValues(request, name) {
  return (request.headers.get("Cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`))
    .map((part) => part.slice(name.length + 1));
}

function oneCookie(request, name) {
  const values = cookieValues(request, name);
  return values.length === 1 ? values[0] : null;
}

function oneQueryParameter(url, name) {
  const values = url.searchParams.getAll(name);
  return values.length === 1 ? values[0] : null;
}

function appendCookie(headers, name, value, options = SESSION_COOKIE_OPTIONS) {
  headers.append("Set-Cookie", `${name}=${value}; ${options}`);
}

function clearCookie(headers, name) {
  appendCookie(
    headers,
    name,
    "",
    `${SESSION_COOKIE_OPTIONS}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
  );
}

function fixedOrigin(env) {
  if (typeof env.PUBLIC_ORIGIN !== "string") {
    throw new AuthError(503, "authentication_not_configured");
  }

  let origin;
  try {
    origin = new URL(env.PUBLIC_ORIGIN);
  } catch {
    throw new AuthError(503, "authentication_not_configured");
  }

  if (
    origin.origin !== env.PUBLIC_ORIGIN ||
    !["https:", "http:"].includes(origin.protocol) ||
    (origin.protocol !== "https:" && env.APP_ENV !== "local")
  ) {
    throw new AuthError(503, "authentication_not_configured");
  }

  return origin.origin;
}

function callbackUri(provider, env, origin) {
  const key = provider === "google" ? "GOOGLE_REDIRECT_URI" : "GITHUB_REDIRECT_URI";
  const expected = `${origin}/api/auth/${provider}/callback`;
  if (env[key] !== expected) {
    throw new AuthError(503, "authentication_not_configured");
  }
  return expected;
}

function assertPagesRequest(request, env) {
  const origin = fixedOrigin(env);
  if (new URL(request.url).origin !== origin) {
    throw new AuthError(404, "not_found");
  }
  return origin;
}

function providerConfig(provider, env) {
  const prefix = provider === "google" ? "GOOGLE" : "GITHUB";
  const clientId = env[`${prefix}_CLIENT_ID`];
  const clientSecret = env[`${prefix}_CLIENT_SECRET`];
  if (
    typeof clientId !== "string" ||
    !clientId.trim() ||
    typeof clientSecret !== "string" ||
    !clientSecret.trim()
  ) {
    throw new AuthError(503, "oauth_provider_not_configured");
  }
  return { clientId, clientSecret };
}

function database(env) {
  if (!env.DB || typeof env.DB.prepare !== "function") {
    throw new AuthError(503, "authentication_storage_unavailable");
  }
  return env.DB;
}

function authFetch(env) {
  return typeof env.OAUTH_FETCH === "function" ? env.OAUTH_FETCH : fetch;
}

function providerError(status = 502, diagnostic) {
  if (diagnostic) {
    console.error(
      JSON.stringify({
        event: "oauth_provider_failure",
        provider: diagnostic.provider,
        stage: diagnostic.stage,
        reason: diagnostic.reason,
        ...(Number.isInteger(diagnostic.httpStatus)
          ? { httpStatus: diagnostic.httpStatus }
          : {}),
        ...(SAFE_PROVIDER_ERROR_CODES.has(diagnostic.providerCode)
          ? { providerCode: diagnostic.providerCode }
          : {}),
      }),
    );
  }
  throw new AuthError(status, "identity_provider_unavailable");
}

async function createTransaction(db, transaction) {
  await db
    .prepare("DELETE FROM oauth_transactions WHERE expires_at <= ?")
    .bind(new Date().toISOString())
    .run();
  await db
    .prepare(
      `INSERT INTO oauth_transactions (
        state_hash, browser_binding_hash, provider, pkce_verifier_ciphertext,
        nonce_hash, redirect_uri, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      transaction.stateHash,
      transaction.browserHash,
      transaction.provider,
      transaction.verifierCiphertext,
      transaction.nonceHash,
      transaction.redirectUri,
      transaction.expiresAt,
    )
    .run();
}

async function consumeTransaction(db, state, browserBinding, provider, now) {
  return db
    .prepare(
      `DELETE FROM oauth_transactions
       WHERE state_hash = ?
         AND browser_binding_hash = ?
         AND provider = ?
         AND expires_at > ?
       RETURNING state_hash, provider, pkce_verifier_ciphertext,
                 nonce_hash, redirect_uri`,
    )
    .bind(
      await sha256(state),
      await sha256(browserBinding),
      provider,
      now.toISOString(),
    )
    .first();
}

async function beginAuthorization(request, env, provider) {
  const origin = assertPagesRequest(request, env);
  const { clientId } = providerConfig(provider, env);
  const redirectUri = callbackUri(provider, env, origin);
  const db = database(env);
  const state = randomToken();
  const browserBinding = randomToken();
  const verifier = randomToken(48);
  const nonce = provider === "google" ? randomToken() : null;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OAUTH_TRANSACTION_TTL_MS);
  const stateHash = await sha256(state);

  await createTransaction(db, {
    stateHash,
    browserHash: await sha256(browserBinding),
    provider,
    verifierCiphertext: await encryptVerifier(
      verifier,
      stateHash,
      provider,
      env,
    ),
    nonceHash: nonce ? await sha256(nonce) : null,
    redirectUri,
    expiresAt: expiresAt.toISOString(),
  });

  const authorizeUrl = new URL(
    provider === "google" ? GOOGLE_AUTHORIZE_URL : GITHUB_AUTHORIZE_URL,
  );
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", await pkceChallenge(verifier));
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  if (provider === "google") {
    authorizeUrl.searchParams.set("scope", "openid email profile");
    authorizeUrl.searchParams.set("nonce", nonce);
  } else {
    authorizeUrl.searchParams.set("scope", "read:user");
  }

  const headers = new Headers({
    Location: authorizeUrl.toString(),
    "Cache-Control": "no-store",
  });
  appendCookie(headers, OAUTH_COOKIE, browserBinding, OAUTH_COOKIE_OPTIONS);
  return new Response(null, { status: 302, headers });
}

async function safeProviderErrorCode(response) {
  try {
    const body = await response.clone().json();
    return SAFE_PROVIDER_ERROR_CODES.has(body.error) ? body.error : null;
  } catch {
    return null;
  }
}

async function parseJsonResponse(response, provider, stage) {
  if (!response.ok) {
    providerError(502, {
      provider,
      stage,
      reason: "http_error",
      httpStatus: response.status,
      providerCode: await safeProviderErrorCode(response),
    });
  }
  try {
    return await response.json();
  } catch {
    providerError(502, { provider, stage, reason: "invalid_json" });
  }
}

async function exchangeCode(provider, code, transaction, env) {
  const { clientId, clientSecret } = providerConfig(provider, env);
  const verifier = await decryptVerifier(
    transaction.pkce_verifier_ciphertext,
    transaction.state_hash,
    provider,
    env,
  );
  const parameters = {
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: transaction.redirect_uri,
    code_verifier: verifier,
  };
  if (provider === "google") {
    parameters.grant_type = "authorization_code";
  }
  const body = new URLSearchParams(parameters);

  let response;
  try {
    response = await authFetch(env)(
      provider === "google" ? GOOGLE_TOKEN_URL : GITHUB_TOKEN_URL,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      },
    );
  } catch {
    providerError(502, {
      provider,
      stage: "token_exchange",
      reason: "network_error",
    });
  }

  const tokenData = await parseJsonResponse(
    response,
    provider,
    "token_exchange",
  );
  if (typeof tokenData.access_token !== "string" || !tokenData.access_token) {
    providerError(401, {
      provider,
      stage: "token_exchange",
      reason: "missing_access_token",
    });
  }
  return tokenData;
}

function decodeJwtPart(part) {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlDecode(part)));
  } catch {
    throw new AuthError(401, "invalid_identity_token");
  }
}

async function googleIdentity(idToken, transaction, env) {
  const segments = idToken.split(".");
  if (segments.length !== 3) {
    throw new AuthError(401, "invalid_identity_token");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = segments;
  const header = decodeJwtPart(encodedHeader);
  const claims = decodeJwtPart(encodedPayload);
  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    throw new AuthError(401, "invalid_identity_token");
  }

  let jwksResponse;
  try {
    jwksResponse = await authFetch(env)(GOOGLE_JWKS_URL, {
      headers: { Accept: "application/json" },
    });
  } catch {
    providerError(502, {
      provider: "google",
      stage: "jwks_fetch",
      reason: "network_error",
    });
  }
  const jwks = await parseJsonResponse(
    jwksResponse,
    "google",
    "jwks_fetch",
  );
  const jwk = jwks.keys?.find(
    (key) =>
      key.kid === header.kid &&
      key.kty === "RSA" &&
      (!key.alg || key.alg === "RS256") &&
      key.use !== "enc",
  );
  if (!jwk) {
    throw new AuthError(401, "invalid_identity_token");
  }

  let validSignature = false;
  try {
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    validSignature = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      base64UrlDecode(encodedSignature),
      new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
    );
  } catch {
    throw new AuthError(401, "invalid_identity_token");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const { clientId } = providerConfig("google", env);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (
    !validSignature ||
    !["accounts.google.com", "https://accounts.google.com"].includes(claims.iss) ||
    !audiences.includes(clientId) ||
    (audiences.length > 1 && claims.azp !== clientId) ||
    (claims.azp !== undefined && claims.azp !== clientId) ||
    !Number.isFinite(claims.exp) ||
    claims.exp <= nowSeconds ||
    !Number.isFinite(claims.iat) ||
    claims.iat > nowSeconds + 60 ||
    (Number.isFinite(claims.nbf) && claims.nbf > nowSeconds + 60) ||
    (await sha256(claims.nonce ?? "")) !== transaction.nonce_hash ||
    typeof claims.sub !== "string" ||
    !claims.sub
  ) {
    throw new AuthError(401, "invalid_identity_token");
  }

  const emailVerified =
    claims.email_verified === true || claims.email_verified === "true";
  return {
    subject: claims.sub,
    displayName:
      typeof claims.name === "string" && claims.name.trim()
        ? claims.name.trim().slice(0, 100)
        : "Jogador",
    email:
      emailVerified && typeof claims.email === "string"
        ? claims.email.slice(0, 320)
        : null,
    emailVerified: emailVerified ? 1 : 0,
  };
}

async function githubIdentity(accessToken, env) {
  let response;
  try {
    response = await authFetch(env)(GITHUB_USER_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${accessToken}`,
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
    });
  } catch {
    providerError(502, {
      provider: "github",
      stage: "user_profile_fetch",
      reason: "network_error",
    });
  }
  const profile = await parseJsonResponse(
    response,
    "github",
    "user_profile_fetch",
  );
  const subject =
    typeof profile.id === "number" && Number.isSafeInteger(profile.id) && profile.id > 0
      ? String(profile.id)
      : typeof profile.id === "string" && /^\d+$/.test(profile.id)
        ? profile.id
        : null;
  if (!subject) {
    throw new AuthError(401, "invalid_provider_identity");
  }
  const name =
    typeof profile.name === "string" && profile.name.trim()
      ? profile.name.trim()
      : typeof profile.login === "string" && profile.login.trim()
        ? profile.login.trim()
        : "Jogador";
  return {
    subject,
    displayName: name.slice(0, 100),
    email: null,
    emailVerified: 0,
  };
}

async function findOrCreateUser(db, provider, identity) {
  const existing = await db
    .prepare(
      `SELECT users.id, users.display_name, users.status
       FROM provider_identities
       JOIN users ON users.id = provider_identities.user_id
       WHERE provider_identities.provider = ?
         AND provider_identities.provider_subject = ?`,
    )
    .bind(provider, identity.subject)
    .first();
  if (existing) {
    if (existing.status !== "active") {
      throw new AuthError(403, "account_disabled");
    }
    if (provider === "google") {
      await db
        .prepare(
          `UPDATE provider_identities
           SET email = ?, email_verified = ?
           WHERE provider = ? AND provider_subject = ?`,
        )
        .bind(identity.email, identity.emailVerified, provider, identity.subject)
        .run();
    }
    return existing;
  }

  const userId = crypto.randomUUID();
  await db.batch([
    db
      .prepare("INSERT INTO users (id, display_name) VALUES (?, ?)")
      .bind(userId, identity.displayName),
    db
      .prepare(
        `INSERT INTO provider_identities (
          id, user_id, provider, provider_subject, email, email_verified
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (provider, provider_subject) DO NOTHING`,
      )
      .bind(
        crypto.randomUUID(),
        userId,
        provider,
        identity.subject,
        identity.email,
        identity.emailVerified,
      ),
  ]);

  const linked = await db
    .prepare(
      `SELECT users.id, users.display_name, users.status
       FROM provider_identities
       JOIN users ON users.id = provider_identities.user_id
       WHERE provider_identities.provider = ?
         AND provider_identities.provider_subject = ?`,
    )
    .bind(provider, identity.subject)
    .first();
  if (!linked) {
    throw new AuthError(503, "authentication_storage_unavailable");
  }
  if (linked.id !== userId) {
    await db
      .prepare(
        `DELETE FROM users
         WHERE id = ?
           AND NOT EXISTS (
             SELECT 1 FROM provider_identities WHERE user_id = ?
           )`,
      )
      .bind(userId, userId)
      .run();
  }
  if (linked.status !== "active") {
    throw new AuthError(403, "account_disabled");
  }
  return linked;
}

async function establishSession(db, userId) {
  const sessionId = randomToken();
  const sessionHash = await sha256(sessionId);
  const expiresAt = new Date(
    Date.now() + SESSION_TTL_SECONDS * 1000,
  ).toISOString();
  await db
    .prepare(
      "INSERT INTO sessions (id_hash, user_id, expires_at) VALUES (?, ?, ?)",
    )
    .bind(sessionHash, userId, expiresAt)
    .run();
  return { sessionId, expiresAt };
}

function oauthFailureResponse(error) {
  const failure =
    error instanceof AuthError
      ? error
      : new AuthError(503, "authentication_unavailable");
  return jsonResponse({ error: failure.code }, failure.status);
}

async function completeAuthorization(request, env, provider) {
  const origin = assertPagesRequest(request, env);
  callbackUri(provider, env, origin);
  const db = database(env);
  const url = new URL(request.url);
  const state = oneQueryParameter(url, "state");
  const code = oneQueryParameter(url, "code");
  const providerErrorParam = oneQueryParameter(url, "error");
  const browserBinding = oneCookie(request, OAUTH_COOKIE);
  if (
    !state ||
    state.length > 256 ||
    !browserBinding
  ) {
    throw new AuthError(400, "invalid_oauth_response");
  }

  const transaction = await consumeTransaction(
    db,
    state,
    browserBinding,
    provider,
    new Date(),
  );
  if (!transaction) {
    throw new AuthError(400, "invalid_oauth_state");
  }
  if (providerErrorParam !== null) {
    throw new AuthError(400, "oauth_authorization_denied");
  }
  if (!code || code.length > 2048) {
    throw new AuthError(400, "invalid_oauth_response");
  }
  if (transaction.redirect_uri !== callbackUri(provider, env, origin)) {
    throw new AuthError(400, "invalid_oauth_response");
  }

  const tokens = await exchangeCode(provider, code, transaction, env);
  let identity;
  if (provider === "google") {
    if (typeof tokens.id_token !== "string") {
      throw new AuthError(401, "invalid_identity_token");
    }
    identity = await googleIdentity(tokens.id_token, transaction, env);
  } else {
    identity = await githubIdentity(tokens.access_token, env);
  }

  const user = await findOrCreateUser(db, provider, identity);
  const session = await establishSession(db, user.id);
  const headers = new Headers({
    Location: `${origin}/`,
    "Cache-Control": "no-store",
  });
  appendCookie(
    headers,
    SESSION_COOKIE,
    session.sessionId,
    `${SESSION_COOKIE_OPTIONS}; Max-Age=${SESSION_TTL_SECONDS}`,
  );
  clearCookie(headers, OAUTH_COOKIE);
  return new Response(null, { status: 302, headers });
}

export async function getAuthenticatedUser(request, env) {
  assertPagesRequest(request, env);
  const sessionId = oneCookie(request, SESSION_COOKIE);
  if (!sessionId) {
    return null;
  }

  const now = new Date().toISOString();
  const user = await database(env)
    .prepare(
      `SELECT users.id, users.display_name
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.id_hash = ?
         AND sessions.revoked_at IS NULL
         AND sessions.expires_at > ?
         AND users.status = 'active'`,
    )
    .bind(await sha256(sessionId), now)
    .first();
  return user ?? null;
}

async function currentSession(request, env) {
  const user = await getAuthenticatedUser(request, env);
  if (!user) {
    return jsonResponse({ authenticated: false, user: null });
  }
  return jsonResponse({
    authenticated: true,
    user: { displayName: user.display_name },
  });
}

async function logout(request, env) {
  const origin = assertPagesRequest(request, env);
  if (
    request.headers.get("Origin") !== origin ||
    !request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")
  ) {
    throw new AuthError(403, "csrf_check_failed");
  }

  const sessionId = oneCookie(request, SESSION_COOKIE);
  if (sessionId) {
    await database(env)
      .prepare(
        `UPDATE sessions
         SET revoked_at = ?
         WHERE id_hash = ? AND revoked_at IS NULL`,
      )
      .bind(new Date().toISOString(), await sha256(sessionId))
      .run();
  }

  const headers = new Headers({ "Cache-Control": "no-store" });
  clearCookie(headers, SESSION_COOKIE);
  return jsonResponse({ authenticated: false }, 200, headers);
}

const ROUTES = new Map([
  ["/auth/google/start", { method: "GET", provider: "google", action: "start" }],
  ["/auth/google/callback", { method: "GET", provider: "google", action: "callback" }],
  ["/auth/github/start", { method: "GET", provider: "github", action: "start" }],
  ["/auth/github/callback", { method: "GET", provider: "github", action: "callback" }],
  ["/auth/session", { method: "GET", action: "session" }],
  ["/auth/logout", { method: "POST", action: "logout" }],
]);

export async function handleAuthRequest(request, env) {
  const route = ROUTES.get(new URL(request.url).pathname);
  if (!route) {
    return null;
  }
  if (request.method !== route.method) {
    return jsonResponse({ error: "method_not_allowed" }, 405, {
      Allow: route.method,
    });
  }

  try {
    if (route.action === "start") {
      return await beginAuthorization(request, env, route.provider);
    }
    if (route.action === "callback") {
      return await completeAuthorization(request, env, route.provider);
    }
    if (route.action === "session") {
      return await currentSession(request, env);
    }
    return await logout(request, env);
  } catch (error) {
    const response = oauthFailureResponse(error);
    if (route.action === "callback") {
      const headers = new Headers(response.headers);
      clearCookie(headers, OAUTH_COOKIE);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }
    return response;
  }
}

export const authConstants = {
  OAUTH_COOKIE,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
};
