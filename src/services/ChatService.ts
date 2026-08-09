import { seededMessages, seededThreads } from "../data/seed";
import type { ChatMessage, ChatThread } from "../types";
import { uid } from "../utils/format";

export const ChatService = {
  listThreads(): ChatThread[] {
    return seededThreads;
  },

  listMessages(): ChatMessage[] {
    return seededMessages;
  },

  makeMessage(
    threadId: string,
    senderId: string,
    body: string,
    attachmentUrl?: string,
    attachmentThumbUrl?: string,
  ): ChatMessage {
    return {
      id: uid("msg"),
      threadId,
      senderId,
      body,
      attachmentUrl,
      attachmentThumbUrl,
      createdAt: Date.now(),
      // Every new message starts as 'sent' (single ✓). It becomes 'delivered'
      // when the recipient's app fetches it and 'read' when they open the chat.
      status: "sent",
    };
  },
};
