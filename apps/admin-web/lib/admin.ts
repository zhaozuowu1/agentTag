export function authorizeAdmin(header: string | null, token: string): boolean {
  if (!token || !header) {
    return false;
  }
  return header === `Bearer ${token}`;
}

export function toggleChatEnabled<T extends { chatId: string; enabled: boolean }>(
  chats: T[],
  chatId: string,
  enabled: boolean,
): T[] {
  return chats.map((chat) => (chat.chatId === chatId ? { ...chat, enabled } : chat));
}
