import { describe, expect, it } from "vitest";
import { authorizeAdmin, toggleChatEnabled } from "./admin.ts";

describe("authorizeAdmin", () => {
  it("accepts the ADMIN_TOKEN bearer header", () => {
    expect(authorizeAdmin("Bearer secret", "secret")).toBe(true);
    expect(authorizeAdmin("Bearer nope", "secret")).toBe(false);
    expect(authorizeAdmin(null, "secret")).toBe(false);
  });
});

describe("toggleChatEnabled", () => {
  it("flips enabled on a grant record", () => {
    const chats = [{ tenantKey: "t1", chatId: "oc_1", enabled: true, chatType: "private" }];
    expect(toggleChatEnabled(chats, "oc_1", false)).toEqual([
      { tenantKey: "t1", chatId: "oc_1", enabled: false, chatType: "private" },
    ]);
  });
});
