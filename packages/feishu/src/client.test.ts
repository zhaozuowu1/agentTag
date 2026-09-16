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

  it("keeps the header title as status and puts the model id on subtitle plus a body footer", () => {
    const card = progressCard({
      title: "处理完成",
      statusText: "已完成",
      checklist: [{ id: "1", label: "读取群历史", status: "done" }],
      markdown: "结论：两件未关闭事项。",
      modelId: "qwen3.8-max",
      enableThinking: false,
    });
    expect(card.header.title.content).toBe("处理完成");
    expect(card.header.subtitle).toEqual({ tag: "plain_text", content: "qwen3.8-max" });
    const body = card.body.elements[0]?.content ?? "";
    expect(body).toContain("结论：两件未关闭事项。");
    expect(body.trim().endsWith("模型：`qwen3.8-max`")).toBe(true);
    expect(body).not.toContain("Claude");
  });

  it("marks thinking on the subtitle without pasting reasoning onto the card", () => {
    const card = progressCard({
      title: "正在处理",
      statusText: "进行中",
      checklist: [{ id: "1", label: "读取群历史", status: "doing" }],
      markdown: "正在调用工具。",
      modelId: "ZHIPU/GLM-5.3",
      enableThinking: true,
    });
    expect(card.header.title.content).toBe("正在处理");
    expect(card.header.subtitle).toEqual({ tag: "plain_text", content: "ZHIPU/GLM-5.3 · 思考" });
    expect(card.body.elements[0]?.content).toContain("模型：`ZHIPU/GLM-5.3`");
    expect(card.body.elements[0]?.content).not.toContain("reasoning");
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

describe("botOpenId", () => {
  it("reads open_id from the top-level bot field in GET /bot/v3/info", async () => {
    const officialBody = {
      code: 0,
      msg: "ok",
      bot: {
        activate_status: 2,
        app_name: "name",
        avatar_url: "https://sf1-ttcdn-tos.pstatp.com/img/lark.avatar/xxxx",
        ip_white_list: [] as string[],
        open_id: "ou_bot_official",
      },
    };
    const { fetchImpl, calls } = recordFetch(
      () => new Response(JSON.stringify(officialBody), { status: 200 }),
    );
    const client = clientWith(fetchImpl);

    await expect(client.botOpenId()).resolves.toBe("ou_bot_official");
    expect(new URL(calls[0]!.url).pathname).toBe("/open-apis/bot/v3/info");
  });
});

describe("sendCard", () => {
  it("POSTs an interactive card to the chat and returns the bot message id", async () => {
    const { fetchImpl, calls } = recordFetch(
      () =>
        new Response(JSON.stringify({ code: 0, data: { message_id: "om_card_sent" } }), { status: 200 }),
    );
    const client = clientWith(fetchImpl);
    const result = await client.sendCard(
      "oc_auth",
      progressCard({
        title: "收到，正在处理",
        statusText: "进行中",
        checklist: [],
      }),
    );
    expect(result).toEqual({ messageId: "om_card_sent" });
    expect(calls[0]?.method).toBe("POST");
    expect(new URL(calls[0]!.url).pathname).toBe("/open-apis/im/v1/messages");
    const body = JSON.parse(await calls[0]!.text()) as Record<string, unknown>;
    expect(body.receive_id).toBe("oc_auth");
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

describe("listMessages file metadata", () => {
  it("exposes file_key and file_name from file messages so the agent can import a CSV", async () => {
    const { fetchImpl } = recordFetch(
      () =>
        new Response(
          JSON.stringify({
            code: 0,
            data: {
              items: [
                {
                  message_id: "om_csv",
                  chat_id: "oc_auth",
                  msg_type: "file",
                  body: { content: JSON.stringify({ file_key: "file_csv_1", file_name: "sales.csv" }) },
                  sender: { id: "ou_user" },
                  create_time: "t1",
                },
              ],
            },
          }),
          { status: 200 },
        ),
    );
    const client = clientWith(fetchImpl);
    const messages = await client.listMessages({ container: "chat", id: "oc_auth" });
    expect(messages[0]).toMatchObject({
      messageId: "om_csv",
      messageType: "file",
      fileKey: "file_csv_1",
      fileName: "sales.csv",
      imageKey: null,
    });
  });
});

describe("downloadMessageResource", () => {
  it("GETs the IM resource bytes without JSON wrapping", async () => {
    const csv = "month,amount\n1,10\n";
    const { fetchImpl, calls } = recordFetch((req) => {
      if (req.url.includes("/resources/")) {
        return new Response(csv, { status: 200, headers: { "Content-Type": "text/csv" } });
      }
      return new Response(JSON.stringify({ code: 0, data: {} }), { status: 200 });
    });
    const client = clientWith(fetchImpl);
    const bytes = await client.downloadMessageResource("om_csv", "file_csv_1", "file");
    expect(new TextDecoder().decode(bytes)).toBe(csv);
    const req = calls.find((call) => call.url.includes("/resources/"));
    expect(req?.method).toBe("GET");
    expect(new URL(req!.url).pathname).toBe("/open-apis/im/v1/messages/om_csv/resources/file_csv_1");
    expect(new URL(req!.url).searchParams.get("type")).toBe("file");
  });
});

describe("uploadImage and reply image in thread", () => {
  it("uploads png bytes then replies in the thread with image_key", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const { fetchImpl, calls } = recordFetch((req) => {
      if (req.url.includes("/im/v1/images")) {
        return new Response(JSON.stringify({ code: 0, data: { image_key: "img_chart" } }), { status: 200 });
      }
      if (req.url.endsWith("/reply")) {
        return new Response(JSON.stringify({ code: 0, data: { message_id: "om_img", thread_id: "omt_1" } }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ code: 0, data: {} }), { status: 200 });
    });
    const client = clientWith(fetchImpl);
    const uploaded = await client.uploadImage(png, "chart.png");
    expect(uploaded).toEqual({ imageKey: "img_chart" });
    const replied = await client.replyInThreadMessage("om_card", {
      msgType: "image",
      content: { image_key: uploaded.imageKey },
    });
    expect(replied).toEqual({ messageId: "om_img", threadId: "omt_1" });

    const uploadReq = calls.find((call) => call.url.includes("/im/v1/images"));
    expect(uploadReq?.method).toBe("POST");
    const contentType = uploadReq?.headers.get("content-type") ?? "";
    expect(contentType).toMatch(/multipart\/form-data/i);
    expect(uploadReq?.headers.get("authorization")).toBe("Bearer tenant-token");

    const replyReq = calls.find((call) => call.url.endsWith("/reply") && call.method === "POST");
    const replyBody = JSON.parse(await replyReq!.text()) as Record<string, unknown>;
    expect(replyBody.reply_in_thread).toBe(true);
    expect(replyBody.msg_type).toBe("image");
    expect(JSON.parse(String(replyBody.content))).toEqual({ image_key: "img_chart" });
  });
});
