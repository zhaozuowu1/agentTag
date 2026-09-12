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
    await store.delete({ tenantKey: "t1", chatId: "oc_1", id: saved.id });
    expect(await store.list({ tenantKey: "t1", chatId: "oc_1" })).toEqual([]);
  });

  it("does not let one chat rewrite another chat's memory", async () => {
    const store = createMemoryStore();
    const saved = await store.upsert({
      tenantKey: "t1",
      scope: "chat",
      chatId: "oc_a",
      kind: "instruction",
      text: "群A约定",
      sourceSessionId: "sess_a",
      createdByOpenId: "ou_user",
      chatType: "private",
    });
    await expect(
      store.upsert({
        id: saved.id,
        tenantKey: "t1",
        scope: "chat",
        chatId: "oc_b",
        kind: "instruction",
        text: "被改写",
        sourceSessionId: "sess_b",
        createdByOpenId: "ou_user",
        chatType: "private",
      }),
    ).rejects.toThrow(/belong|chat/i);
    expect((await store.list({ tenantKey: "t1", chatId: "oc_a" })).map((row) => row.text)).toEqual(["群A约定"]);
    expect(await store.list({ tenantKey: "t1", chatId: "oc_b" })).toEqual([]);
  });

  it("does not let one chat delete another chat's memory", async () => {
    const store = createMemoryStore();
    const saved = await store.upsert({
      tenantKey: "t1",
      scope: "chat",
      chatId: "oc_a",
      kind: "fact",
      text: "群A事实",
      sourceSessionId: null,
      createdByOpenId: "ou_user",
      chatType: "private",
    });
    await expect(store.delete({ tenantKey: "t1", chatId: "oc_b", id: saved.id })).rejects.toThrow(/belong|chat/i);
    expect(await store.list({ tenantKey: "t1", chatId: "oc_a" })).toHaveLength(1);
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
