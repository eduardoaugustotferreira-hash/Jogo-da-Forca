const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json(
        { status: "scaffold", ready: false },
        { headers: jsonHeaders },
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
