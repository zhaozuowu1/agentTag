import { NextResponse } from "next/server";
import { createDb, authorizedChats, memoryEntries, tenants, usageEvents } from "@agenttag/db";
import {
  DASHSCOPE_MODEL_CATALOG,
  DEFAULT_DASHSCOPE_MODEL,
  resolveRuntimeModel,
  tokensToUsd,
} from "@agenttag/domain";
import { and, eq, gte, sum } from "drizzle-orm";
import { authorizeAdmin } from "../../../lib/admin.ts";
import { applyTenantModelPatch } from "../../../lib/tenant-model.ts";

function db() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required");
  }
  return createDb(url).db;
}

function unauthorized() {
  return NextResponse.json({ error: "未授权" }, { status: 401 });
}

function requireAdmin(req: Request) {
  const token = process.env.ADMIN_TOKEN ?? "";
  return authorizeAdmin(req.headers.get("authorization"), token);
}

function parseLimitUsd(raw: string | null | undefined): number | null {
  if (raw == null || raw === "") {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function envModelId(): string {
  const raw = process.env.DASHSCOPE_MODEL;
  return raw && raw.trim() !== "" ? raw : DEFAULT_DASHSCOPE_MODEL;
}

function modelSnapshot(tenantRow: { modelId: string | null; enableThinking: boolean } | undefined) {
  const resolved = resolveRuntimeModel({
    tenantModelId: tenantRow?.modelId,
    tenantEnableThinking: tenantRow?.enableThinking,
    envModelId: envModelId(),
  });
  return {
    modelId: resolved.modelId,
    enableThinking: resolved.enableThinking,
    source: resolved.source,
    tenantModelId: tenantRow?.modelId ?? null,
    catalog: DASHSCOPE_MODEL_CATALOG,
  };
}

async function snapshot(database: ReturnType<typeof db>, tenantKey: string) {
  const chats = await database.select().from(authorizedChats).where(eq(authorizedChats.tenantKey, tenantKey));
  const tenantRows = await database.select().from(tenants).where(eq(tenants.tenantKey, tenantKey)).limit(1);
  const limitUsd = parseLimitUsd(tenantRows[0]?.monthlyLimitUsd);
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const usageRows = await database
    .select({
      input: sum(usageEvents.inputTokens),
      output: sum(usageEvents.outputTokens),
    })
    .from(usageEvents)
    .where(and(eq(usageEvents.tenantKey, tenantKey), gte(usageEvents.createdAt, monthStart)));
  const memories = await database.select().from(memoryEntries).where(eq(memoryEntries.tenantKey, tenantKey));
  const tenant = tenantRows[0];
  return {
    chats,
    usage: {
      usedUsd: tokensToUsd(Number(usageRows[0]?.input ?? 0), Number(usageRows[0]?.output ?? 0)),
      limitUsd,
    },
    model: modelSnapshot(
      tenant ? { modelId: tenant.modelId, enableThinking: tenant.enableThinking } : undefined,
    ),
    memories,
  };
}

export async function GET(req: Request) {
  if (!requireAdmin(req)) {
    return unauthorized();
  }
  const tenantKey = new URL(req.url).searchParams.get("tenantKey") ?? "default";
  const database = db();
  return NextResponse.json(await snapshot(database, tenantKey));
}

export async function POST(req: Request) {
  if (!requireAdmin(req)) {
    return unauthorized();
  }
  const body = (await req.json()) as {
    tenantKey?: string;
    chatId?: string;
    chatType?: string;
    enabled?: boolean;
  };
  const tenantKey = body.tenantKey ?? "default";
  const chatId = body.chatId;
  if (!chatId) {
    return NextResponse.json({ error: "缺少 chatId" }, { status: 400 });
  }
  const database = db();
  await database.insert(tenants).values({ tenantKey }).onConflictDoNothing();
  await database
    .insert(authorizedChats)
    .values({
      tenantKey,
      chatId,
      chatType: body.chatType ?? "private",
      enabled: body.enabled ?? true,
    })
    .onConflictDoUpdate({
      target: [authorizedChats.tenantKey, authorizedChats.chatId],
      set: { enabled: body.enabled ?? true, chatType: body.chatType ?? "private" },
    });
  return NextResponse.json(await snapshot(database, tenantKey));
}

export async function PATCH(req: Request) {
  if (!requireAdmin(req)) {
    return unauthorized();
  }
  const body = (await req.json()) as {
    tenantKey?: string;
    chatId?: string;
    enabled?: boolean;
    monthlyLimitUsd?: number | null;
    modelId?: string | null;
    enableThinking?: boolean;
  };
  const tenantKey = body.tenantKey ?? "default";
  const database = db();
  if ("modelId" in body || "enableThinking" in body) {
    await database.insert(tenants).values({ tenantKey }).onConflictDoNothing();
    const currentRows = await database.select().from(tenants).where(eq(tenants.tenantKey, tenantKey)).limit(1);
    const row = {
      modelId: currentRows[0]?.modelId ?? null,
      enableThinking: currentRows[0]?.enableThinking ?? false,
    };
    const patch: { modelId?: string | null; enableThinking?: boolean } = {};
    if ("modelId" in body) {
      patch.modelId = body.modelId ?? null;
    }
    if ("enableThinking" in body) {
      patch.enableThinking = body.enableThinking;
    }
    const applied = applyTenantModelPatch(row, patch);
    if (!applied.ok) {
      return NextResponse.json({ error: applied.error }, { status: 400 });
    }
    await database
      .update(tenants)
      .set({ modelId: row.modelId, enableThinking: row.enableThinking })
      .where(eq(tenants.tenantKey, tenantKey));
    if (!body.chatId && !("monthlyLimitUsd" in body)) {
      return NextResponse.json(await snapshot(database, tenantKey));
    }
  }
  if ("monthlyLimitUsd" in body) {
    await database.insert(tenants).values({ tenantKey }).onConflictDoNothing();
    const limit = body.monthlyLimitUsd;
    await database
      .update(tenants)
      .set({ monthlyLimitUsd: limit == null ? null : String(limit) })
      .where(eq(tenants.tenantKey, tenantKey));
    if (!body.chatId) {
      return NextResponse.json(await snapshot(database, tenantKey));
    }
  }
  if (!body.chatId || typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "缺少 chatId 或 enabled" }, { status: 400 });
  }
  await database
    .update(authorizedChats)
    .set({ enabled: body.enabled })
    .where(and(eq(authorizedChats.tenantKey, tenantKey), eq(authorizedChats.chatId, body.chatId)));
  return NextResponse.json(await snapshot(database, tenantKey));
}

export async function DELETE(req: Request) {
  if (!requireAdmin(req)) {
    return unauthorized();
  }
  const url = new URL(req.url);
  const memoryId = url.searchParams.get("memoryId");
  const tenantKey = url.searchParams.get("tenantKey") ?? "default";
  if (!memoryId) {
    return NextResponse.json({ error: "缺少 memoryId" }, { status: 400 });
  }
  const database = db();
  await database
    .delete(memoryEntries)
    .where(and(eq(memoryEntries.id, memoryId), eq(memoryEntries.tenantKey, tenantKey)));
  return NextResponse.json(await snapshot(database, tenantKey));
}
