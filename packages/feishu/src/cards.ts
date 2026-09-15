export type ChecklistStatus = "todo" | "doing" | "done" | "blocked";

export interface ProgressCardItem {
  id: string;
  label: string;
  status: ChecklistStatus | string;
}

export interface ProgressCardInput {
  title: string;
  statusText: string;
  checklist: ProgressCardItem[];
  markdown?: string;
  modelId?: string;
  enableThinking?: boolean;
}

const marks: Record<string, string> = {
  todo: "☐",
  doing: "►",
  done: "☑",
  blocked: "⚠",
};

export function progressCardSubtitle(modelId: string, enableThinking: boolean): string {
  return enableThinking ? `${modelId} · 思考` : modelId;
}

export function modelFooterLine(modelId: string): string {
  return `模型：\`${modelId}\``;
}

export function progressCard(input: ProgressCardInput) {
  const items = input.checklist.map((item) => `${marks[item.status] ?? "☐"} ${item.label}`);
  const modelLine = input.modelId ? modelFooterLine(input.modelId) : undefined;
  const content = [input.statusText, ...items, input.markdown, modelLine]
    .filter((part): part is string => Boolean(part && part.length > 0))
    .join("\n");

  return {
    schema: "2.0" as const,
    config: {
      update_multi: true,
    },
    header: {
      title: {
        tag: "plain_text" as const,
        content: input.title,
      },
      ...(input.modelId
        ? {
            subtitle: {
              tag: "plain_text" as const,
              content: progressCardSubtitle(input.modelId, input.enableThinking === true),
            },
          }
        : {}),
      template: "blue",
    },
    body: {
      elements: [
        {
          tag: "markdown" as const,
          content,
        },
      ],
    },
  };
}

export function stringifyCard(card: unknown): string {
  return JSON.stringify(card);
}
