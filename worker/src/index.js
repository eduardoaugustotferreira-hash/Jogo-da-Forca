import { getAuthenticatedUser, handleAuthRequest } from "./auth.js";

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function allowedOrigins(env) {
  return new Set(
    (env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function varyByOrigin(headers) {
  const existing = headers.get("Vary");
  const values = new Set(
    (existing ?? "").split(",").map((value) => value.trim()).filter(Boolean),
  );
  values.add("Origin");
  headers.set("Vary", [...values].join(", "));
}

function healthCorsHeaders(request, env) {
  const headers = new Headers();
  varyByOrigin(headers);

  const origin = request.headers.get("Origin");
  if (origin && allowedOrigins(env).has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }

  return headers;
}

function forbiddenPreflight() {
  return Response.json(
    { error: "cors_origin_or_request_not_allowed" },
    { status: 403, headers: jsonHeaders },
  );
}

function responseError(code, status) {
  return Response.json(
    { error: code },
    { status, headers: jsonHeaders },
  );
}

function randomRoomCode() {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = new Uint8Array(12);
  const code = [];
  const ceiling = Math.floor(256 / alphabet.length) * alphabet.length;
  while (code.length < 16) {
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte < ceiling) code.push(alphabet[byte % alphabet.length]);
      if (code.length === 16) break;
    }
  }
  return code.join("");
}

function publicOrigin(env) {
  return typeof env.PUBLIC_ORIGIN === "string" ? env.PUBLIC_ORIGIN : null;
}

async function authenticatedUser(request, env) {
  try {
    return await getAuthenticatedUser(request, env);
  } catch (error) {
    if (error?.status === 404) return null;
    return responseError(
      error?.status === 503 ? error.code : "authentication_unavailable",
      503,
    );
  }
}

function mutationOriginAllowed(request, env) {
  return (
    request.headers.get("Origin") === publicOrigin(env) &&
    request.headers
      .get("Content-Type")
      ?.toLowerCase()
      .startsWith("application/json")
  );
}

async function boundedJson(request) {
  const declaredLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > 2_048) return null;
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 2_048) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function roomRequest(request, env) {
  const url = new URL(request.url);
  const rooms = env.ROOMS;
  if (!rooms || typeof rooms.idFromName !== "function" || typeof rooms.get !== "function") {
    return responseError("rooms_unavailable", 503);
  }
  const user = await authenticatedUser(request, env);
  if (user instanceof Response) return user;
  if (!user) return responseError("authentication_required", 401);

  const createPath = url.pathname === "/v1/rooms";
  const create = request.method === "POST" && createPath;
  const joinMatch = url.pathname.match(/^\/v1\/rooms\/([A-Z2-9]{16})\/join$/);
  const snapshotMatch = url.pathname.match(/^\/v1\/rooms\/([A-Z2-9]{16})$/);
  const socketMatch = url.pathname.match(/^\/v1\/rooms\/([A-Z2-9]{16})\/ws$/);
  if (createPath && request.method !== "POST") {
    return responseError("method_not_allowed", 405);
  }
  if (!create && !joinMatch && !snapshotMatch && !socketMatch) {
    return responseError("not_found", 404);
  }
  if (joinMatch && request.method !== "POST") {
    return responseError("method_not_allowed", 405);
  }
  if (create || joinMatch) {
    if (!mutationOriginAllowed(request, env)) {
      return responseError("csrf_check_failed", 403);
    }
  } else if (snapshotMatch) {
    if (request.method !== "GET") return responseError("method_not_allowed", 405);
  } else if (
    request.method !== "GET" ||
    request.headers.get("Origin") !== publicOrigin(env) ||
    request.headers.get("Upgrade")?.toLowerCase() !== "websocket"
  ) {
    return responseError("websocket_origin_or_upgrade_invalid", 403);
  }

  if (create || joinMatch) {
    const body = await boundedJson(request);
    if (!body || !["knight", "archer", "mage"].includes(body.characterId)) {
      return responseError("invalid_request", 400);
    }
    const code = create ? randomRoomCode() : joinMatch[1];
    const stub = rooms.get(rooms.idFromName(code));
    const path = create ? "/_internal/create" : "/_internal/join";
    return stub.fetch(
      new Request(`https://room.internal${path}?code=${code}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user: { id: user.id, displayName: user.display_name },
          characterId: body.characterId,
        }),
      }),
    );
  }

  const code = snapshotMatch?.[1] ?? socketMatch?.[1];
  const stub = rooms.get(rooms.idFromName(code));
  const headers = new Headers(request.headers);
  headers.delete("Cookie");
  headers.delete("Authorization");
  headers.set("x-room-user-id", user.id);
  if (socketMatch) {
    const socketRequest = new Request(request, { headers });
    return stub.fetch(socketRequest);
  }
  return stub.fetch(
    new Request("https://room.internal/_internal/snapshot", {
      method: "GET",
      headers: { "x-room-user-id": user.id },
    }),
  );
}

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);

    const authResponse = await handleAuthRequest(request, env);
    if (authResponse) {
      return authResponse;
    }

    if (request.method === "OPTIONS") {
      const origin = request.headers.get("Origin");
      const requestedMethod = request.headers.get("Access-Control-Request-Method");
      const requestedHeaders = (
        request.headers.get("Access-Control-Request-Headers") ?? ""
      )
        .split(",")
        .map((header) => header.trim().toLowerCase())
        .filter(Boolean);

      if (
        url.pathname !== "/health" ||
        !origin ||
        !allowedOrigins(env).has(origin) ||
        requestedMethod !== "GET" ||
        requestedHeaders.some((header) => header !== "content-type")
      ) {
        return forbiddenPreflight();
      }

      const headers = healthCorsHeaders(request, env);
      headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
      if (requestedHeaders.length > 0) {
        headers.set("Access-Control-Allow-Headers", "Content-Type");
      }
      headers.set(
        "Vary",
        "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
      );
      return new Response(null, { status: 204, headers });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      const headers = new Headers(jsonHeaders);
      for (const [name, value] of healthCorsHeaders(request, env)) {
        headers.set(name, value);
      }
      return Response.json(
        { status: "ok", ready: Boolean(env.DB && env.ROOMS) },
        { headers },
      );
    }

    if (url.pathname === "/v1/rooms" || url.pathname.startsWith("/v1/rooms/")) {
      return roomRequest(request, env);
    }

    return Response.json(
      { error: "not_found" },
      { status: 404, headers: jsonHeaders },
    );
  },
};

export { Room } from "./room.js";
