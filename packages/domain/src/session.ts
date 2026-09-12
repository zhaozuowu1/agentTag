export type ChecklistItem = {
  id: string;
  label: string;
  status: "todo" | "doing" | "done" | "blocked";
};

export type TranscriptEvent =
  | { type: "user"; openId: string; text: string; at: string }
  | { type: "assistant"; text: string; at: string }
  | {
      type: "tool_result";
      name: string;
      toolUseId: string;
      content: string;
      at: string;
    }
  | { type: "error"; message: string; at: string };

export interface AgentTurnResult {
  checklist: ChecklistItem[];
  replyMarkdown: string;
  stop: boolean;
}
