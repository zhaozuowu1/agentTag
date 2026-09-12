import { describe, expect, it } from "vitest";
import { GET } from "./route.ts";

describe("GET /api/chats", () => {
  it("rejects requests without the admin bearer token", async () => {
    process.env.ADMIN_TOKEN = "secret";
    const res = await GET(new Request("http://localhost/api/chats"));
    expect(res.status).toBe(401);
  });
});
