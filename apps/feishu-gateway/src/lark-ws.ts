import type { FeishuEventMode } from "@agenttag/config";
import { Domain, EventDispatcher, LoggerLevel, WSClient } from "@larksuiteoapi/node-sdk";

const HEADER_KEYS = new Set(["event_id", "event_type", "token", "create_time", "app_id", "tenant_key"]);

const LONG_CONNECTION_EVENTS = [
  "im.message.receive_v1",
  "im.chat.member.bot.added_v1",
  "im.chat.member.bot.deleted_v1",
] as const;

function asRecord(data: unknown): Record<string, unknown> {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return {};
}

function isWebhookEnvelope(data: Record<string, unknown>): boolean {
  return typeof data.header === "object" && data.header !== null && "event" in data;
}

export function larkDispatcherDataToPayload(data: Record<string, unknown>): Record<string, unknown> {
  if (isWebhookEnvelope(data)) {
    return data;
  }
  const header: Record<string, unknown> = {};
  const event: Record<string, unknown> = {};
  let schema: unknown = "2.0";
  for (const [key, value] of Object.entries(data)) {
    if (HEADER_KEYS.has(key)) {
      header[key] = value;
    } else if (key === "schema") {
      schema = value;
    } else {
      event[key] = value;
    }
  }
  return { schema, header, event };
}

export function larkWsClientConfig(input: {
  appId: string;
  appSecret: string;
  onReady?: () => void;
  onError?: (err: Error) => void;
}) {
  return {
    appId: input.appId,
    appSecret: input.appSecret,
    domain: Domain.Feishu,
    loggerLevel: LoggerLevel.warn,
    onReady: input.onReady,
    onError: input.onError,
  };
}

export function assertFeishuWsAppId(appId: string): void {
  if (!/^cli_[0-9a-fA-F]{16}$/.test(appId)) {
    throw new Error("FEISHU_APP_ID 格式无效，无法建立飞书长连接");
  }
}

export function createFeishuEventDispatcher(options: {
  onEvent: (payload: Record<string, unknown>) => Promise<void>;
  encryptKey?: string;
  verificationToken?: string;
}): EventDispatcher {
  const dispatch = (data: unknown): void => {
    // Long connection must ack within 3s; reuse HTTP's fire-and-forget onEvent.
    void options.onEvent(larkDispatcherDataToPayload(asRecord(data))).catch((error) => {
      console.error("feishu event handler failed", error);
    });
  };
  const handles = Object.fromEntries(LONG_CONNECTION_EVENTS.map((type) => [type, dispatch]));
  return new EventDispatcher({
    encryptKey: options.encryptKey,
    verificationToken: options.verificationToken,
    loggerLevel: LoggerLevel.warn,
  }).register(handles);
}

export async function startFeishuLongConnection(options: {
  mode: FeishuEventMode;
  appId: string;
  appSecret: string;
  eventDispatcher: EventDispatcher;
  onReady?: () => void;
  onError?: (err: Error) => void;
  startWsClient?: (opts: {
    appId: string;
    appSecret: string;
    eventDispatcher: EventDispatcher;
  }) => void | Promise<void>;
}): Promise<void> {
  if (options.mode !== "websocket") {
    return;
  }
  if (options.startWsClient) {
    await options.startWsClient({
      appId: options.appId,
      appSecret: options.appSecret,
      eventDispatcher: options.eventDispatcher,
    });
    return;
  }
  assertFeishuWsAppId(options.appId);
  const client = new WSClient(
    larkWsClientConfig({
      appId: options.appId,
      appSecret: options.appSecret,
      onReady: options.onReady,
      onError: options.onError,
    }),
  );
  await client.start({ eventDispatcher: options.eventDispatcher });
}
