export type EventProgress = {
  card?: { messageId: string; threadId: string | null };
  welcomeSent?: boolean;
  appended?: boolean;
  sessionId?: string;
  created?: boolean;
};

export function mergeProgress(current: EventProgress | null | undefined, patch: EventProgress): EventProgress {
  return { ...current, ...patch };
}
