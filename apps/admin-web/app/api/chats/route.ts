import { NextResponse } from "next/server";
import { createDb, authorizedChats, memoryEntries, tenants, usageEvents } from "@agenttag/db";
import { tokensToUsd } from "@agenttag/domain";
import { and, eq, gte, sum } from "drizzle-orm";
import { authorizeAdmin } from "../../../lib/admin.ts";

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

async function snapshot(database: ReturnType<typeof db>, tenantKey: string) {
  const chats = await database.select().from(authorizedChats).where(eq(authorizedChats.tenantKey, tenantKey));
  const tenantRows = await database.select().from(tenants).where(eq(tenants.tenantKey, tenantKey)).limit(1);
  const limitUsd = Number(tenantRows[0]?.monthlyLimitUsd ?? 0);
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
  return {
    chats,
    usage: {
      usedUsd: tokensToUsd(Number(usageRows[0]?.input ?? 0), Number(usageRows[0]?.output ?? 0)),
      limitUsd,
    },
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
  const body = (await req.json()) as { tenantKey?: string; chatId?: string; enabled?: boolean };
  const tenantKey = body.tenantKey ?? "default";
  if (!body.chatId || typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "缺少 chatId 或 enabled" }, { status: 400 });
  }
  const database = db();
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
  await database.delete(memoryEntries).where(eq(memoryEntries.id, memoryId));
  return NextResponse.json(await snapshot(database, tenantKey));
}
