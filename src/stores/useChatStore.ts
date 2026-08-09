import { create } from "zustand";
import { persist } from "zustand/middleware";
import { seededWorkers } from "../data/seed";
import { ChatService } from "../services/ChatService";
import { SupabaseService } from "../services/SupabaseService";
import { Outbox, blobToDataUrl } from "../services/Outbox";
import type { PickedPhoto } from "../services/MediaService";
import { translate } from "../i18n";
import type { ChatMessage, ChatThread } from "../types";
import { uid } from "../utils/format";
import { useAuthStore } from "./useAuthStore";
import { useNotificationStore } from "./useNotificationStore";

interface ChatState {
  threads: ChatThread[];
  messages: ChatMessage[];
  selectedThreadId: string;
  chatsLoaded: boolean;
  loadCloudChats: (userId: string) => Promise<void>;
  selectThread: (id: string) => void;
  sendMessage: (body: string, photo?: PickedPhoto) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  createGroup: () => Promise<void>;
  openDirectThread: (otherUserId: string) => Promise<void>;
  leaveThread: (threadId: string) => Promise<void>;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      threads: ChatService.listThreads(),
      messages: ChatService.listMessages(),
      selectedThreadId: "thread_group",
      chatsLoaded: false,
      loadCloudChats: async (userId) => {
        try {
          const threads = await SupabaseService.ensureDefaultThreads(userId);
          const threadMessages = await Promise.all(
            threads.map((thread) => SupabaseService.loadMessages(thread.id)),
          );
          const current = get().selectedThreadId;
          const fromServer = threadMessages.flat();

          // Merge, don't replace. A message you just sent lives locally for a
          // moment before the insert is visible to the next fetch — replacing
          // wholesale made it VANISH until a later poll, so your own message
          // appeared to take seconds to arrive. Keep any local message the
          // server hasn't returned yet, but only briefly, so messages that were
          // genuinely deleted (by you or the other person) still disappear.
          const IN_FLIGHT_MS = 60_000;
          const serverIds = new Set(fromServer.map((m) => m.id));
          const now = Date.now();
          const stillInFlight = get().messages.filter(
            (m) => !serverIds.has(m.id) && now - m.createdAt < IN_FLIGHT_MS,
          );
          const messages = [...fromServer, ...stillInFlight].sort(
            (a, b) => a.createdAt - b.createdAt,
          );

          set({
            threads,
            // Keep the conversation the user is currently viewing.
            selectedThreadId: threads.some((t) => t.id === current)
              ? current
              : threads[0]?.id ?? current,
            messages,
          });
          // Read receipts: fetching incoming messages means they reached this
          // device → flip the sender's ticks from ✓ (sent) to ✓✓ (delivered).
          if (messages.some((m) => m.senderId !== userId && m.status === "sent")) {
            void SupabaseService.markDelivered(userId).catch(() => undefined);
          }
        } catch (error) {
          // Keep locally-seeded threads/messages when the cloud is unreachable.
          console.warn("Could not load cloud chats:", error);
        } finally {
          set({ chatsLoaded: true });
        }
      },
      selectThread: (id) =>
        set((state) => ({
          selectedThreadId: id,
          threads: state.threads.map((thread) =>
            thread.id === id ? { ...thread, unreadCount: 0 } : thread,
          ),
        })),
      deleteMessage: async (messageId) => {
        const user = useAuthStore.getState().user;
        const previous = get().messages;
        set((state) => ({ messages: state.messages.filter((m) => m.id !== messageId) }));
        if (!user || !SupabaseService.enabled) return;
        try {
          await SupabaseService.deleteMessage(messageId, user.id);
        } catch (error) {
          // Put it back — the poll would otherwise resurrect it confusingly.
          set({ messages: previous });
          console.warn("Could not delete message:", error);
        }
      },
      sendMessage: async (body, photo) => {
        const threadId = get().selectedThreadId;
        const user = useAuthStore.getState().user;
        if (!user) return;
        const senderId = SupabaseService.enabled ? user.id : "me";
        // Upload first so the stored message carries URLs, not image bytes.
        // A failure here falls through to the outbox below with the photo intact.
        let image: { url: string; thumbUrl: string } | undefined;
        if (photo && SupabaseService.enabled) {
          try {
            image = await SupabaseService.uploadPhoto(user.id, photo);
          } catch {
            image = undefined;
          }
        }
        const outgoing = ChatService.makeMessage(threadId, senderId, body, image?.url, image?.thumbUrl);
        set((state) => ({
          messages: [...state.messages, outgoing],
          threads: bumpThread(state.threads, threadId),
        }));

        if (SupabaseService.enabled) {
          try {
            await SupabaseService.sendMessage(outgoing);
          } catch {
            // Deleting the driver's message was the old behaviour and it is the
            // wrong one: they typed it, and a tunnel is not a reason to throw it
            // away. Queue it, leave it on screen marked pending, and send it when
            // the signal returns.
            const queued = Outbox.add({
              kind: "message",
              userId: user.id,
              threadId,
              messageId: outgoing.id,
              body,
              photo: photo
                ? { full: await blobToDataUrl(photo.full), thumb: await blobToDataUrl(photo.thumb) }
                : undefined,
            });
            if (!queued)
              useNotificationStore.getState().push(
                translate("notif_queueFullTitle"),
                translate("notif_queueFullBody"),
                "chat",
              );
          }
          return;
        }

        window.setTimeout(() => {
          const state = get();
          const thread = state.threads.find((item) => item.id === threadId);
          const responder = seededWorkers.find((worker) => thread?.participantIds.includes(worker.id));
          const reply = ChatService.makeMessage(
            threadId,
            responder?.id ?? "worker_alex",
            "Copy that. I will update the group if demand changes nearby.",
          );
          set((latest) => ({
            messages: [...latest.messages, reply],
            threads: bumpThread(latest.threads, threadId).map((item) =>
              item.id === threadId ? { ...item, unreadCount: item.id === latest.selectedThreadId ? 0 : 1 } : item,
            ),
          }));
          useNotificationStore.getState().push(translate("notif_newMessage"), reply.body, "chat");
        }, 1200);
      },
      createGroup: async () => {
        const user = useAuthStore.getState().user;
        if (SupabaseService.enabled && user) {
          try {
            const thread = await SupabaseService.createThread(user.id, "New Driver Group", true);
            set((state) => ({
              threads: [thread, ...state.threads],
              selectedThreadId: thread.id,
            }));
          } catch (error) {
            useNotificationStore.getState().push(
              "Group not created",
              error instanceof Error ? error.message : "Could not create the group chat.",
              "chat",
            );
          }
          return;
        }
        const id = uid("thread");
        set((state) => ({
          threads: [
            {
              id,
              title: "New Driver Group",
              participantIds: ["me", "worker_alex", "worker_maria"],
              isGroup: true,
              unreadCount: 0,
              typingUserIds: [],
              updatedAt: Date.now(),
            },
            ...state.threads,
          ],
          selectedThreadId: id,
        }));
      },
      leaveThread: async (threadId) => {
        const user = useAuthStore.getState().user;
        const previous = get().threads;
        // Optimistic: drop it from the list, restore if the server refuses.
        set((state) => ({
          threads: state.threads.filter((t) => t.id !== threadId),
          messages: state.messages.filter((m) => m.threadId !== threadId),
          selectedThreadId:
            state.selectedThreadId === threadId
              ? state.threads.find((t) => t.id !== threadId)?.id ?? ""
              : state.selectedThreadId,
        }));
        if (!user || !SupabaseService.enabled) return;
        try {
          await SupabaseService.leaveThread(threadId, user.id);
        } catch {
          set({ threads: previous });
          useNotificationStore
            .getState()
            .push(translate("wa_leaveFailed"), translate("wa_leaveFailedBody"), "chat");
        }
      },
      openDirectThread: async (otherUserId) => {
        const user = useAuthStore.getState().user;
        if (!user || !SupabaseService.enabled) return;
        try {
          const threadId = await SupabaseService.startDirectThread(otherUserId);
          await get().loadCloudChats(user.id);
          set({ selectedThreadId: threadId });
        } catch (error) {
          useNotificationStore.getState().push(
            "Could not open chat",
            error instanceof Error ? error.message : "Please try again.",
            "chat",
          );
        }
      },
    }),
    { name: "masaya_chat_v3" },
  ),
);

function bumpThread(threads: ChatThread[], threadId: string) {
  return threads
    .map((thread) => (thread.id === threadId ? { ...thread, updatedAt: Date.now() } : thread))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
