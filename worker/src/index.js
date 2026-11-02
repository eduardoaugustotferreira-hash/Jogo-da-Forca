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

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);

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
        { status: "scaffold", ready: false },
        { headers },
      );
    }

    if (url.pathname.startsWith("/v1/rooms/")) {
      return Response.json(
        { error: "multiplayer_not_implemented" },
        { status: 501, headers: jsonHeaders },
      );
    }

    return Response.json(
      { error: "not_found" },
      { status: 404, headers: jsonHeaders },
    );
  },
};

export { Room } from "./room.js";
