import { describe, expect, it } from "vitest";
import { progressCard } from "./cards.ts";
import { createFeishuClient } from "./client.ts";

function recordFetch(handler: (req: Request) => Response | Promise<Response>) {
  const calls: Request[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    calls.push(req);
    return handler(req);
  };
  return { fetchImpl, calls };
}

function clientWith(fetchImpl: typeof fetch) {
  return createFeishuClient({
    appId: "cli_app",
    appSecret: "secret",
    baseUrl: "https://open.feishu.cn",
    fetch: fetchImpl,
    getTenantAccessToken: async () => "tenant-token",
  });
}

describe("progressCard", () => {
  it("uses card schema 2.0 with update_multi so PATCH can edit in place", () => {
    const card = progressCard({
      title: "收到，正在处理",
      statusText: "排队中",
      checklist: [{ id: "1", label: "读取群历史", status: "todo" }],
    });
    expect(card.schema).toBe("2.0");
    expect(card.config.update_multi).toBe(true);
  });
});

describe("replyInThread", () => {
  it("replies with reply_in_thread true and returns message and thread ids", async () => {
    const { fetchImpl, calls } = recordFetch(
      () =>
        new Response(
          JSON.stringify({
            code: 0,
            data: { message_id: "om_reply", thread_id: "omt_1" },
          }),
          { status: 200 },
        ),
    );
    const client = clientWith(fetchImpl);
    const result = await client.replyInThread("om_root", progressCard({
      title: "收到，正在处理",
      statusText: "排队中",
      checklist: [],
    }));
    expect(result).toEqual({ messageId: "om_reply", threadId: "omt_1" });
    expect(calls[0]?.method).toBe("POST");
    expect(new URL(calls[0]!.url).pathname).toBe("/open-apis/im/v1/messages/om_root/reply");
    const body = JSON.parse(await calls[0]!.text()) as Record<string, unknown>;
    expect(body.reply_in_thread).toBe(true);
    expect(body.msg_type).toBe("interactive");
  });
});

describe("patchCard", () => {
  it("PATCHes /im/v1/messages/:id with only { content }", async () => {
    const { fetchImpl, calls } = recordFetch(
      () => new Response(JSON.stringify({ code: 0, msg: "ok" }), { status: 200 }),
    );
    const client = clientWith(fetchImpl);
    const card = progressCard({
      title: "收到，正在处理",
      statusText: "进行中",
      checklist: [],
    });

    await client.patchCard("om_msg", card);

    expect(calls).toHaveLength(1);
    const req = calls[0];
    expect(req).toBeDefined();
    expect(req!.method).toBe("PATCH");
    expect(new URL(req!.url).pathname).toBe("/open-apis/im/v1/messages/om_msg");
    const body = JSON.parse(await req!.text()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["content"]);
    expect(body.msg_type).toBeUndefined();
    expect(typeof body.content).toBe("string");
    expect(JSON.parse(body.content as string)).toMatchObject({ schema: "2.0" });
  });
});
