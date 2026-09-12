import { describe, expect, it } from "vitest";
import { createMemoryStore } from "./store.ts";

describe("MemoryStore", () => {
  it("lists, upserts, and deletes chat-scoped entries", async () => {
    const store = createMemoryStore();
    const saved = await store.upsert({
      tenantKey: "t1",
      scope: "chat",
      chatId: "oc_1",
      kind: "instruction",
      text: "本群发周报用表格",
      sourceSessionId: "sess_1",
      createdByOpenId: "ou_user",
      chatType: "private",
    });
    expect(saved.scope).toBe("chat");
    const listed = await store.list({ tenantKey: "t1", chatId: "oc_1" });
    expect(listed.map((row) => row.text)).toEqual(["本群发周报用表格"]);
    await store.delete(saved.id);
    expect(await store.list({ tenantKey: "t1", chatId: "oc_1" })).toEqual([]);
  });

  it("rejects workspace writes from a private chat", async () => {
    const store = createMemoryStore();
    await expect(
      store.upsert({
        tenantKey: "t1",
        scope: "workspace",
        chatId: "oc_private",
        kind: "fact",
        text: "secret",
        sourceSessionId: null,
        createdByOpenId: "ou_user",
        chatType: "private",
      }),
    ).rejects.toThrow(/workspace/);
  });
});
