import { describe, expect, it } from "vitest";
import { botAddedText, shouldRunInChat } from "./authz.ts";

const group = {
  authorized: true,
  enabled: true,
  external: false,
  chatType: "public" as const,
  allowP2p: false,
};

describe("shouldRunInChat", () => {
  it("runs in an authorized enabled internal group", () => {
    expect(shouldRunInChat(group)).toBe("run");
    expect(shouldRunInChat({ ...group, chatType: "private" })).toBe("run");
  });

  it("explains unauthorized when the chat is not on the allowlist or is disabled", () => {
    expect(shouldRunInChat({ ...group, authorized: false })).toBe("explain_unauthorized");
    expect(shouldRunInChat({ ...group, enabled: false })).toBe("explain_unauthorized");
  });

  it("ignores external chats", () => {
    expect(shouldRunInChat({ ...group, external: true })).toBe("ignore");
  });

  it("explains p2p in MVP instead of running", () => {
    expect(shouldRunInChat({ ...group, chatType: "p2p" })).toBe("explain_p2p");
    expect(shouldRunInChat({ ...group, chatType: "p2p", allowP2p: true })).toBe("run");
  });
});

describe("botAddedText", () => {
  it("asks admins to grant unauthorized chats in the console", () => {
    expect(botAddedText("explain_unauthorized")).toContain("AgentTag");
    expect(botAddedText("explain_unauthorized")).toContain("授权");
  });

  it("introduces itself as a teammate in authorized chats", () => {
    expect(botAddedText("run")).toContain("@");
    expect(botAddedText("run")).toContain("队友");
  });

  it("does not speak in external chats", () => {
    expect(botAddedText("ignore")).toBeNull();
  });
});
