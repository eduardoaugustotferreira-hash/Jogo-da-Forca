export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/health" || url.pathname === "/auth/logout") {
      const body = ["GET", "HEAD"].includes(request.method)
        ? ""
        : await request.text();
      const headers = new Headers({ "Content-Type": "application/json" });
      headers.append("Set-Cookie", "test-one=1; Path=/; Secure");
      headers.append("Set-Cookie", "test-two=2; Path=/; HttpOnly");
      return Response.json(
        {
          method: request.method,
          path: url.pathname,
          search: url.search,
          body,
          cookie: request.headers.get("cookie"),
          origin: request.headers.get("origin"),
          forwardedHost: request.headers.get("x-forwarded-host"),
        },
        { headers },
      );
    }

    if (url.pathname === "/v1/rooms/proxy-test/ws") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();
      server.addEventListener("message", (event) => server.send(event.data));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === "/auth/start") {
      return new Response(null, {
        status: 302,
        headers: {
          Location: "https://github.com/login/oauth/authorize?client_id=synthetic",
        },
      });
    }

    if (url.pathname === "/auth/unsafe-redirect") {
      return new Response(null, {
        status: 302,
        headers: { Location: "https://attacker.example/redirect" },
      });
    }

    return Response.json({ error: "not_found" }, { status: 404 });
  },
};
