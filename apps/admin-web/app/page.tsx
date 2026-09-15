"use client";

import { useCallback, useMemo, useState } from "react";
import { thinkingSwitchForSelection } from "../lib/tenant-model.ts";

interface CatalogEntry {
  id: string;
  label: string;
  thinking: "hybrid" | "always";
  group: string;
  groupLabel: string;
}

interface Snapshot {
  chats: Array<{ tenantKey: string; chatId: string; enabled: boolean; chatType: string }>;
  usage: { usedUsd: number; limitUsd: number | null };
  model: {
    modelId: string;
    enableThinking: boolean;
    source: "chat" | "tenant" | "env";
    tenantModelId: string | null;
    envModelId: string;
    catalog: CatalogEntry[];
  };
  memories: Array<{ id: string; chatId: string | null; kind: string; text: string }>;
}

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [tenantKey, setTenantKey] = useState("default");
  const [chatId, setChatId] = useState("");
  const [limitInput, setLimitInput] = useState("");
  const [modelId, setModelId] = useState("");
  const [enableThinking, setEnableThinking] = useState(false);
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const headers = useCallback(
    () => ({
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    }),
    [token],
  );

  const selected = useMemo(() => {
    const previewId = modelId || data?.model.envModelId || data?.model.modelId;
    return data?.model.catalog.find((entry) => entry.id === previewId);
  }, [data, modelId]);
  const alwaysThinking = selected?.thinking === "always";

  function applySnapshot(snapshot: Snapshot) {
    setData(snapshot);
    setLimitInput(snapshot.usage.limitUsd == null ? "" : String(snapshot.usage.limitUsd));
    setModelId(snapshot.model.tenantModelId ?? "");
    setEnableThinking(snapshot.model.enableThinking);
    setError(null);
  }

  async function load(next?: Snapshot) {
    if (next) {
      applySnapshot(next);
      return;
    }
    const res = await fetch(`/api/chats?tenantKey=${encodeURIComponent(tenantKey)}`, { headers: headers() });
    if (!res.ok) {
      setError("无法加载，请检查 ADMIN_TOKEN。");
      return;
    }
    applySnapshot((await res.json()) as Snapshot);
  }

  async function saveLimit() {
    const trimmed = limitInput.trim();
    const monthlyLimitUsd = trimmed === "" ? null : Number(trimmed);
    if (monthlyLimitUsd != null && !Number.isFinite(monthlyLimitUsd)) {
      setError("月度上限必须是数字，留空表示未设。");
      return;
    }
    const res = await fetch("/api/chats", {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ tenantKey, monthlyLimitUsd }),
    });
    if (res.ok) {
      await load((await res.json()) as Snapshot);
    }
  }

  async function saveModel() {
    const res = await fetch("/api/chats", {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({
        tenantKey,
        modelId,
        enableThinking: alwaysThinking ? true : enableThinking,
      }),
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      setError(payload.error ?? "保存模型失败。");
      return;
    }
    await load((await res.json()) as Snapshot);
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

  const catalogGroups = useMemo(() => {
    const groups: Array<{ label: string; entries: CatalogEntry[] }> = [];
    for (const entry of data?.model.catalog ?? []) {
      const last = groups.at(-1);
      if (!last || last.label !== entry.groupLabel) {
        groups.push({ label: entry.groupLabel, entries: [entry] });
      } else {
        last.entries.push(entry);
      }
    }
    return groups;
  }, [data]);

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
              {data.usage.limitUsd == null ? " / 未设上限" : ` / 上限 ${data.usage.limitUsd} USD`}
            </p>
            <label>
              月度上限 USD（空=未设，0=禁止新会话）
              <input
                value={limitInput}
                onChange={(event) => setLimitInput(event.target.value)}
                inputMode="decimal"
                placeholder="未设"
              />
            </label>
            <button type="button" onClick={() => void saveLimit()}>
              保存上限
            </button>
          </section>
          <section>
            <h2>推理模型</h2>
            <p>
              当前生效 <code>{data.model.modelId}</code>
              {data.model.source === "tenant" ? "（后台）" : "（环境变量 DASHSCOPE_MODEL）"}
              {data.model.enableThinking ? " · 思考" : ""}
            </p>
            <label>
              模型
              <select
                value={modelId}
                onChange={(event) => {
                  const next = event.target.value;
                  const previousMode = selected?.thinking;
                  const previewId = next || data.model.envModelId;
                  const nextMode = data.model.catalog.find((item) => item.id === previewId)?.thinking;
                  setModelId(next);
                  setEnableThinking(
                    thinkingSwitchForSelection({
                      previousMode,
                      nextMode,
                      currentEnableThinking: enableThinking,
                    }),
                  );
                }}
              >
                <option value="">跟随环境变量 DASHSCOPE_MODEL</option>
                {catalogGroups.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.entries.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.id} — {entry.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={alwaysThinking ? true : enableThinking}
                disabled={alwaysThinking}
                onChange={(event) => setEnableThinking(event.target.checked)}
              />
              深度思考
            </label>
            <p>
              {alwaysThinking
                ? "该模型始终思考，不能关闭。"
                : "开启后简单问候也会变慢、更贵。飞书日常对话建议关闭。"}
            </p>
            <button type="button" onClick={() => void saveModel()}>
              保存模型
            </button>
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
