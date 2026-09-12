export type ChatType = "public" | "private" | "p2p";

export type RunDecision = "run" | "ignore" | "explain_unauthorized" | "explain_p2p";

export function shouldRunInChat(input: {
  authorized: boolean;
  enabled: boolean;
  external: boolean;
  chatType: ChatType;
  allowP2p: boolean;
}): RunDecision {
  if (input.chatType === "p2p" && !input.allowP2p) {
    return "explain_p2p";
  }
  if (input.external) {
    return "ignore";
  }
  if (!input.authorized || !input.enabled) {
    return "explain_unauthorized";
  }
  return "run";
}

export function botAddedText(decision: RunDecision): string | null {
  switch (decision) {
    case "run":
      return "我是本群队友，@ 我即可把任务交给我。";
    case "explain_unauthorized":
      return "请管理员在 AgentTag 控制台授权本群后，我才能执行任务。";
    case "explain_p2p":
      return "请在已授权的群里 @ 我。";
    case "ignore":
      return null;
  }
}
