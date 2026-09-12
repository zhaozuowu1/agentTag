export type MemoryScope = "workspace" | "chat";
export type MemoryKind = "instruction" | "fact";

export function allowMemoryWrite(input: {
  scope: MemoryScope;
  chatType: "public" | "private" | "p2p";
}): boolean {
  if (input.chatType === "p2p") {
    return false;
  }
  if (input.scope === "workspace") {
    return false;
  }
  return true;
}
