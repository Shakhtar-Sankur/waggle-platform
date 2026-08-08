import { ArrowLeft, ImagePlus, MessageCircle, MoreVertical, Search, Send, Trash2, UsersRound } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { useT } from "../i18n";
import { MediaService } from "../services/MediaService";
import { SupabaseService } from "../services/SupabaseService";
import { useAuthStore } from "../stores/useAuthStore";
import { useChatStore } from "../stores/useChatStore";
import { useCommunityStore } from "../stores/useCommunityStore";
import type { ChatThread, Worker } from "../types";
import { initials, timeAgo } from "../utils/format";

type Translator = ReturnType<typeof useT>;

// WhatsApp-style presence line for a 1-on-1 chat.
function presenceLabel(worker: Worker | undefined, t: Translator): string {
  if (!worker) return "";
  if (worker.isOnline) return t("wa_online");
  if (worker.lastSeen) return t("wa_lastSeen", { time: timeAgo(worker.lastSeen) });
  return t("wa_offline");
}

export function MessagesScreen() {
  const location = useLocation();
  const t = useT();
  const user = useAuthStore((state) => state.user);
  const workers = useCommunityStore((state) => state.workers);
  const threads = useChatStore((state) => state.threads);
  const messages = useChatStore((state) => state.messages);
  const selectThread = useChatStore((state) => state.selectThread);
  const sendMessage = useChatStore((state) => state.sendMessage);
  const deleteMessage = useChatStore((state) => state.deleteMessage);
  const createGroup = useChatStore((state) => state.createGroup);
  const loadCloudChats = useChatStore((state) => state.loadCloudChats);
  const chatsLoaded = useChatStore((state) => state.chatsLoaded);
  const loadCloudCommunity = useCommunityStore((state) => state.loadCloudCommunity);

  const [openId, setOpenId] = useState<string | null>(
    (location.state as { openThreadId?: string } | null)?.openThreadId ?? null,
  );
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<string | undefined>();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Keep chats fresh (RLS makes chat too complex for live-broadcast, so we
  // poll). Poll fast while a conversation is actually open — that is when a
  // reply needs to feel instant — and back off on the chat list, which costs
  // less traffic overall than a flat 2.5s everywhere.
  useEffect(() => {
    if (!user || !SupabaseService.enabled) return undefined;
    const every = openId ? 1200 : 4000;
    const timer = window.setInterval(() => void loadCloudChats(user.id), every);
    return () => window.clearInterval(timer);
  }, [user, loadCloudChats, openId]);

  // Refresh presence (online / last-seen) of other drivers while the chat is open.
  useEffect(() => {
    if (!user || !SupabaseService.enabled) return undefined;
    const timer = window.setInterval(() => void loadCloudCommunity(), 15000);
    return () => window.clearInterval(timer);
  }, [user, loadCloudCommunity]);

  // Read receipts: having the conversation OPEN means its incoming messages are
  // seen → flip the sender's ticks to blue ✓✓. Re-runs as new messages poll in.
  useEffect(() => {
    if (!openId || !user || !SupabaseService.enabled) return;
    const unseen = messages.some(
      (m) => m.threadId === openId && m.senderId !== user.id && m.senderId !== "me" && m.status !== "read",
    );
    if (unseen) void SupabaseService.markRead(openId, user.id).catch(() => undefined);
  }, [openId, messages, user]);

  const workerById = useMemo(
    () => Object.fromEntries(workers.map((worker) => [worker.id, worker])),
    [workers],
  );

  const lastOf = (threadId: string) => {
    const msgs = messages.filter((m) => m.threadId === threadId);
    return msgs[msgs.length - 1];
  };

  // The "other" person in a 1-on-1 chat (by participant id, name as a fallback),
  // used for WhatsApp-style online / last-seen presence.
  const otherWorkerOf = (thread: ChatThread | null): Worker | undefined => {
    if (!thread || thread.isGroup) return undefined;
    const otherId = thread.participantIds.find((id) => id !== user?.id);
    return (otherId ? workerById[otherId] : undefined) ?? workers.find((w) => w.name === thread.title);
  };

  // DM titles are stored from the creator's perspective — always show the OTHER
  // participant's name to whoever is looking.
  const displayTitle = (thread: ChatThread): string =>
    thread.isGroup ? thread.title : otherWorkerOf(thread)?.name ?? thread.title;

  const chatList = [...threads]
    .filter((thread) => displayTitle(thread).toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => (lastOf(b.id)?.createdAt ?? b.updatedAt) - (lastOf(a.id)?.createdAt ?? a.updatedAt));

  const openThread = threads.find((thread) => thread.id === openId) ?? null;
  const openOther = otherWorkerOf(openThread);
  const openMessages = messages
    .filter((message) => message.threadId === openId)
    .sort((a, b) => a.createdAt - b.createdAt);

  // WhatsApp scroll behaviour: opening a chat lands on the LATEST message, and
  // sending/receiving one snaps the view to the bottom.
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const lastMessageId = openMessages[openMessages.length - 1]?.id;
  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    // Photos can grow the list after render — re-snap once they finish loading.
    el.querySelectorAll("img").forEach((img) => {
      if (!img.complete)
        img.addEventListener("load", () => {
          el.scrollTop = el.scrollHeight;
        }, { once: true });
    });
  }, [openId, lastMessageId]);

  const openChat = (id: string) => {
    selectThread(id);
    setOpenId(id);
    setDraft("");
    setAttachment(undefined);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim() && !attachment) return;
    await sendMessage(draft.trim() || t("wa_photoMsg"), attachment);
    setDraft("");
    setAttachment(undefined);
  };

  const clock = (ts: number) =>
    new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <main className="page-shell wa-page">
      <div className="wa-search input-shell">
        <Search size={18} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("wa_searchChats")}
        />
      </div>

      <button className="wa-newgroup" onClick={createGroup}>
        <span className="wa-avatar wa-avatar-accent"><UsersRound size={20} /></span>
        {t("wa_newGroup")}
      </button>

      <div className="wa-chat-list">
        {!chatsLoaded && !chatList.length ? (
          [0, 1, 2, 3, 4].map((i) => (
            <div className="wa-chat-row wa-skeleton" key={i}>
              <span className="sk sk-avatar" />
              <div className="wa-chat-meta">
                <span className="sk sk-line" style={{ width: "45%" }} />
                <span className="sk sk-line sk-sm" style={{ width: "65%", marginTop: 8 }} />
              </div>
            </div>
          ))
        ) : chatList.length ? (
          chatList.map((thread) => {
            const last = lastOf(thread.id);
            const mine = last && (last.senderId === user?.id || last.senderId === "me");
            return (
              <button className="wa-chat-row" key={thread.id} onClick={() => openChat(thread.id)}>
                <span className="wa-avatar-wrap">
                  <span className="wa-avatar">
                    {thread.isGroup ? <UsersRound size={20} /> : initials(displayTitle(thread))}
                  </span>
                  {otherWorkerOf(thread)?.isOnline ? <i className="wa-online-dot" /> : null}
                </span>
                <div className="wa-chat-meta">
                  <div className="wa-chat-top">
                    <strong>{displayTitle(thread)}</strong>
                    <small>{last ? timeAgo(last.createdAt) : ""}</small>
                  </div>
                  <p>{last ? `${mine ? `${t("wa_you")}: ` : ""}${last.body}` : t("wa_tapToStart")}</p>
                </div>
                {thread.unreadCount ? <em className="wa-unread">{thread.unreadCount}</em> : null}
              </button>
            );
          })
        ) : (
          <div className="empty-state">
            <MessageCircle size={34} />
            <p>{t("wa_noChats")}</p>
            <span>{t("wa_noChatsSub")}</span>
          </div>
        )}
      </div>

      {openThread
        ? createPortal(
        <div className="wa-convo">
          <header className="wa-convo-header">
            <button className="wa-back" onClick={() => setOpenId(null)} aria-label={t("a11y_back")}>
              <ArrowLeft size={22} />
            </button>
            <span className="wa-avatar-wrap">
              <span className="wa-avatar">
                {openThread.isGroup ? <UsersRound size={20} /> : initials(displayTitle(openThread))}
              </span>
              {!openThread.isGroup && openOther?.isOnline ? <i className="wa-online-dot" /> : null}
            </span>
            <div className="wa-convo-title">
              <strong>{displayTitle(openThread)}</strong>
              {/* Presence is unknown until the other driver's profile loads.
                  Render nothing rather than an empty line, which otherwise
                  leaves a blank gap under the name. */}
              {(() => {
                const line = openThread.isGroup ? t("wa_groupChat") : presenceLabel(openOther, t);
                if (!line) return null;
                return (
                  <small className={!openThread.isGroup && openOther?.isOnline ? "wa-online" : ""}>
                    {line}
                  </small>
                );
              })()}
            </div>
            <button className="wa-back" aria-label={t("a11y_options")}><MoreVertical size={20} /></button>
          </header>

          <div className="wa-messages" ref={messagesRef}>
            {openMessages.length ? (
              openMessages.map((message, index) => {
                const isMe = message.senderId === "me" || message.senderId === user?.id;
                const sender = workerById[message.senderId]?.name ?? "Driver";
                const showSender =
                  openThread.isGroup && !isMe && openMessages[index - 1]?.senderId !== message.senderId;
                return (
                  <div className={`wa-bubble ${isMe ? "me" : ""}`} key={message.id}>
                    {/* Only your own messages can be removed (enforced by RLS too). */}
                    {isMe ? (
                      <button
                        className="wa-del"
                        aria-label={t("wa_deleteMessage")}
                        onClick={() => setConfirmDelete(message.id)}
                      >
                        <Trash2 size={13} />
                      </button>
                    ) : null}
                    {showSender ? <span className="wa-sender">{sender}</span> : null}
                    {message.attachmentUrl?.startsWith("data:") ? (
                      <img className="wa-image" src={message.attachmentUrl} alt="Attachment" />
                    ) : null}
                    {message.body ? <p>{message.body}</p> : null}
                    <small>
                      {clock(message.createdAt)}
                      {isMe ? (
                        <span className={`wa-ticks ${message.status === "read" ? "read" : ""}`}>
                          {" "}{message.status === "sent" ? "✓" : "✓✓"}
                        </span>
                      ) : null}
                    </small>
                  </div>
                );
              })
            ) : (
              <div className="wa-empty">{t("wa_noMessages")}</div>
            )}
          </div>

          <form className="wa-input" onSubmit={submit}>
            <button
              type="button"
              className={`wa-attach ${attachment ? "active" : ""}`}
              aria-label={t("a11y_attachPhoto")}
              onClick={async () => {
                if (attachment) {
                  setAttachment(undefined);
                  return;
                }
                const picked = await MediaService.pickImage();
                if (picked) setAttachment(picked);
              }}
            >
              <ImagePlus size={22} />
            </button>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={attachment ? t("wa_caption") : t("wa_typeMessage")}
            />
            <button type="submit" className="wa-send" aria-label={t("a11y_send")}>
              <Send size={18} />
            </button>
          </form>

          {confirmDelete ? (
            <div className="wa-confirm-scrim" onClick={() => setConfirmDelete(null)}>
              <div className="wa-confirm" onClick={(event) => event.stopPropagation()}>
                <strong>{t("wa_deleteMessage")}</strong>
                <p>{t("wa_deleteMessageSure")}</p>
                <div className="wa-confirm-actions">
                  <button onClick={() => setConfirmDelete(null)}>{t("sv_cancel")}</button>
                  <button
                    className="wa-confirm-del"
                    onClick={() => {
                      const id = confirmDelete;
                      setConfirmDelete(null);
                      if (id) void deleteMessage(id);
                    }}
                  >
                    {t("fb_delete")}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>,
            document.body,
          )
        : null}
    </main>
  );
}
