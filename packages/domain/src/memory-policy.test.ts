import { describe, expect, it } from "vitest";
import { allowMemoryWrite } from "./memory-policy.ts";

describe("allowMemoryWrite", () => {
  it("forbids workspace-scoped writes from private chats", () => {
    expect(
      allowMemoryWrite({
        scope: "workspace",
        chatType: "private",
      }),
    ).toBe(false);
  });

  it("allows chat-scoped writes for private and public groups in MVP", () => {
    expect(allowMemoryWrite({ scope: "chat", chatType: "private" })).toBe(true);
    expect(allowMemoryWrite({ scope: "chat", chatType: "public" })).toBe(true);
  });
});
