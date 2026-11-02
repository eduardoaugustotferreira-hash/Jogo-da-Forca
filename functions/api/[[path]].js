const API_PREFIX = "/api/";
const ALLOWED_METHODS = new Set([
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
]);
const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
];
const PROVIDER_AUTHORIZATION_ENDPOINTS = new Set([
  "https://accounts.google.com/o/oauth2/v2/auth",
  "https://github.com/login/oauth/authorize",
]);

function jsonError(status, code) {
  return Response.json(
    { error: code },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
      },
    },
  );
}

function apiPath(pathname) {
  if (!pathname.startsWith(API_PREFIX)) {
    return null;
  }

  const path = pathname.slice(API_PREFIX.length - 1);
  if (
    path.includes("//") ||
    /%2f|%5c/i.test(path) ||
    path.split("/").some((segment) => {
      try {
        const decoded = decodeURIComponent(segment);
        return (
          decoded === "." ||
          decoded === ".." ||
          decoded.includes("\\") ||
          /[\u0000-\u001f\u007f]/.test(decoded)
        );
      } catch {
        return true;
      }
    })
  ) {
    return null;
  }

  return path;
}

function forwardedRequest(request, path) {
  const headers = new Headers(request.headers);
  const connectionHeaders = (headers.get("connection") ?? "")
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);

  for (const header of HOP_BY_HOP_HEADERS) {
    headers.delete(header);
  }
  for (const header of connectionHeaders) {
    headers.delete(header);
  }

  headers.delete("forwarded");
  headers.delete("host");
  headers.delete("x-forwarded-host");
  headers.delete("x-forwarded-port");
  headers.delete("x-forwarded-proto");
  headers.delete("x-real-ip");

  const upgrade = request.headers.get("upgrade")?.toLowerCase();
  const connection = (request.headers.get("connection") ?? "")
    .split(",")
    .map((header) => header.trim().toLowerCase());
  const isWebSocket = upgrade === "websocket" && connection.includes("upgrade");

  if (upgrade || connection.includes("upgrade")) {
    if (
      !isWebSocket ||
      request.method !== "GET" ||
      !path.startsWith("/v1/rooms/")
    ) {
      return null;
    }

    headers.set("Connection", "Upgrade");
    headers.set("Upgrade", "websocket");
  }

  const targetUrl = new URL(request.url);
  targetUrl.pathname = path;

  return new Request(targetUrl, {
    method: request.method,
    headers,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
    duplex: "half",
    redirect: "manual",
  });
}

function validLocation(location, publicOrigin) {
  if (
    location.startsWith("/") &&
    !location.startsWith("//") &&
    !location.includes("\\")
  ) {
    return true;
  }

  let destination;
  try {
    destination = new URL(location);
  } catch {
    return false;
  }

  if (destination.origin === publicOrigin) {
    return true;
  }

  return PROVIDER_AUTHORIZATION_ENDPOINTS.has(
    `${destination.origin}${destination.pathname}`,
  );
}

function setCookieValues(headers) {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }

  const value = headers.get("set-cookie");
  return value ? [value] : [];
}

function stripCookieDomain(cookie) {
  return cookie.replace(/;\s*domain=[^;]*/gi, "");
}

function responseWithPagesCookies(response) {
  if (response.status === 101) {
    return response;
  }

  const cookies = setCookieValues(response.headers);
  const normalizedCookies = cookies.map(stripCookieDomain);
  if (cookies.every((cookie, index) => cookie === normalizedCookies[index])) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.delete("set-cookie");
  for (const cookie of normalizedCookies) {
    headers.append("Set-Cookie", cookie);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const path = apiPath(url.pathname);
  if (!path) {
    return jsonError(404, "api_route_not_found");
  }

  if (!ALLOWED_METHODS.has(request.method)) {
    return jsonError(405, "method_not_allowed");
  }

  if (!env.API || typeof env.API.fetch !== "function") {
    return jsonError(503, "api_service_unavailable");
  }

  if (!env.PUBLIC_ORIGIN) {
    return jsonError(503, "api_proxy_not_configured");
  }

  const upstreamRequest = forwardedRequest(request, path);
  if (!upstreamRequest) {
    return jsonError(400, "invalid_api_request");
  }

  let response;
  try {
    response = await env.API.fetch(upstreamRequest);
  } catch {
    return jsonError(502, "api_service_unavailable");
  }

  const location = response.headers.get("location");
  if (location && !validLocation(location, env.PUBLIC_ORIGIN)) {
    return jsonError(502, "api_redirect_not_allowed");
  }

  return responseWithPagesCookies(response);
}
