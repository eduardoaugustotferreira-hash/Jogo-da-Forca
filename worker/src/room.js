export class Room {
  async fetch() {
    return Response.json(
      { error: "room_not_implemented" },
      {
        status: 501,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
