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
}

const marks: Record<string, string> = {
  todo: "☐",
  doing: "►",
  done: "☑",
  blocked: "⚠",
};

export function progressCard(input: ProgressCardInput) {
  const items = input.checklist.map((item) => `${marks[item.status] ?? "☐"} ${item.label}`);
  const content = [input.statusText, ...items, input.markdown]
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
