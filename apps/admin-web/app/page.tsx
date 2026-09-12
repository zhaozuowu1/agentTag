"use client";

import { useCallback, useState } from "react";

interface Snapshot {
  chats: Array<{ tenantKey: string; chatId: string; enabled: boolean; chatType: string }>;
  usage: { usedUsd: number; limitUsd: number };
  memories: Array<{ id: string; chatId: string | null; kind: string; text: string }>;
}

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [tenantKey, setTenantKey] = useState("default");
  const [chatId, setChatId] = useState("");
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const headers = useCallback(
    () => ({
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    }),
    [token],
  );

  async function load(next?: Snapshot) {
    if (next) {
      setData(next);
      setError(null);
      return;
    }
    const res = await fetch(`/api/chats?tenantKey=${encodeURIComponent(tenantKey)}`, { headers: headers() });
    if (!res.ok) {
      setError("无法加载，请检查 ADMIN_TOKEN。");
      return;
    }
    setData((await res.json()) as Snapshot);
    setError(null);
  }

  async function addChat() {
    const res = await fetch("/api/chats", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ tenantKey, chatId, chatType: "private", enabled: true }),
    });
    if (res.ok) {
      await load((await res.json()) as Snapshot);
      setChatId("");
    }
  }

  async function toggle(chat: Snapshot["chats"][number]) {
    const res = await fetch("/api/chats", {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ tenantKey, chatId: chat.chatId, enabled: !chat.enabled }),
    });
    if (res.ok) {
      await load((await res.json()) as Snapshot);
    }
  }

  async function removeMemory(id: string) {
    const res = await fetch(
      `/api/chats?tenantKey=${encodeURIComponent(tenantKey)}&memoryId=${encodeURIComponent(id)}`,
      { method: "DELETE", headers: headers() },
    );
    if (res.ok) {
      await load((await res.json()) as Snapshot);
    }
  }

  return (
    <main>
      <h1>AgentTag 管理台</h1>
      <p>配置飞书授权群、查看本月用量，并删除群记忆。聊天表面只做飞书。</p>
      <section>
        <label>
          管理令牌
          <input value={token} onChange={(event) => setToken(event.target.value)} type="password" />
        </label>
        <label>
          租户 tenant_key
          <input value={tenantKey} onChange={(event) => setTenantKey(event.target.value)} />
        </label>
        <button type="button" onClick={() => void load()}>
          加载
        </button>
      </section>
      {error ? <p>{error}</p> : null}
      {data ? (
        <>
          <section>
            <h2>本月用量</h2>
            <p>
              已用 {data.usage.usedUsd.toFixed(4)} USD
              {data.usage.limitUsd > 0 ? ` / 上限 ${data.usage.limitUsd} USD` : " / 未设上限"}
            </p>
          </section>
          <section>
            <h2>授权群</h2>
            <input placeholder="chat_id，例如 oc_xxx" value={chatId} onChange={(event) => setChatId(event.target.value)} />
            <button type="button" onClick={() => void addChat()}>
              添加并启用
            </button>
            <ul>
              {data.chats.map((chat) => (
                <li key={chat.chatId}>
                  {chat.chatId} ({chat.chatType}) {chat.enabled ? "已启用" : "已停用"}
                  <button type="button" onClick={() => void toggle(chat)}>
                    {chat.enabled ? "停用" : "启用"}
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2>群记忆</h2>
            <ul>
              {data.memories.map((memory) => (
                <li key={memory.id}>
                  [{memory.kind}] {memory.chatId}: {memory.text}
                  <button type="button" onClick={() => void removeMemory(memory.id)}>
                    删除
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
    </main>
  );
}
