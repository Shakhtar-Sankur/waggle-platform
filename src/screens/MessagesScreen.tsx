import { ArrowLeft, CornerUpLeft, ImagePlus, LogOut, MessageCircle, Mic, MoreVertical, Pause, Play, Search, Send, SmilePlus, Trash2, UsersRound, X } from "lucide-react";
import { Fragment, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { useBrandBand } from "../hooks/useBrandBand";
import { useT } from "../i18n";
import { MediaService, type PickedPhoto } from "../services/MediaService";
import { clockOf, startRecording, voiceSupported, waveform, type Recorder } from "../services/VoiceService";
import { SupabaseService } from "../services/SupabaseService";
import { useAuthStore } from "../stores/useAuthStore";
import { useChatStore } from "../stores/useChatStore";
import { connectionFor, useCommunityStore } from "../stores/useCommunityStore";
import type { ChatThread, Worker } from "../types";
import { initials, timeAgo } from "../utils/format";

type Translator = ReturnType<typeof useT>;

/** The six on the picker. Deliberately short: a grid of thirty is a search
 *  task, and this is meant to be a single tap while stopped at a light. */
const REACTIONS = ["\u{1F44D}", "\u2764\uFE0F", "\u{1F602}", "\u{1F62E}", "\u{1F622}", "\u{1F64F}"];

/** Today / Yesterday / the date, for the divider between days. */
function dayLabel(ts: number, t: Translator): string {
  const d = new Date(ts);
  const today = new Date();
  const yest = new Date(today);
  yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return t("wa_today");
  if (d.toDateString() === yest.toDateString()) return t("wa_yesterday");
  // Anything older gets a real date, in the reader's own locale.
  return d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}

// WhatsApp-style presence line for a 1-on-1 chat.
function presenceLabel(worker: Worker | undefined, t: Translator): string {
  if (!worker) return "";
  if (worker.isOnline) return t("wa_online");
  if (worker.lastSeen) return t("wa_lastSeen", { time: timeAgo(worker.lastSeen) });
  return t("wa_offline");
}

export function MessagesScreen() {
  useBrandBand("messages");
  const location = useLocation();
  const t = useT();
  const user = useAuthStore((state) => state.user);
  const workers = useCommunityStore((state) => state.workers);
  const threads = useChatStore((state) => state.threads);
  const messages = useChatStore((state) => state.messages);
  const selectThread = useChatStore((state) => state.selectThread);
  const sendMessage = useChatStore((state) => state.sendMessage);
  const deleteMessage = useChatStore((state) => state.deleteMessage);
  const toggleReaction = useChatStore((state) => state.toggleReaction);
  const leaveThread = useChatStore((state) => state.leaveThread);
  const createGroup = useChatStore((state) => state.createGroup);
  const loadCloudChats = useChatStore((state) => state.loadCloudChats);
  const chatsLoaded = useChatStore((state) => state.chatsLoaded);
  const loadCloudCommunity = useCommunityStore((state) => state.loadCloudCommunity);

  const [openId, setOpenId] = useState<string | null>(
    (location.state as { openThreadId?: string } | null)?.openThreadId ?? null,
  );
  const [query, setQuery] = useState("");
  const [chatFilter, setChatFilter] = useState<"all" | "unread" | "groups">("all");
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<PickedPhoto | undefined>();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  /* Voice notes. The recorder lives in a ref rather than state because it is
     a live object with a microphone attached — putting it in state would
     re-render the whole thread sixty times a second as the level changes. */
  const recorderRef = useRef<Recorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [recLevels, setRecLevels] = useState<number[]>([]);
  const [voiceOk] = useState(() => voiceSupported());
  /** Which note is playing, so only one sounds at a time. */
  const [playingId, setPlayingId] = useState<string | null>(null);
  /** The message being replied to, or null. Held by id rather than by value so
   *  it cannot go stale if the original is edited or deleted mid-compose. */
  const [replyTo, setReplyTo] = useState<string | null>(null);
  /** Which message has its emoji picker open. */
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const beginRecording = async () => {
    if (recorderRef.current) return;
    try {
      recorderRef.current = await startRecording(() => void finishRecording());
      setRecording(true);
    } catch {
      // Refused microphone, or a browser that cannot record. Saying nothing
      // would leave a button that does nothing when pressed, which is how a
      // driver decides a feature is broken.
      setRecording(false);
      recorderRef.current = null;
      window.alert(t("wa_micDenied"));
    }
  };

  const cancelRecording = () => {
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setRecording(false);
    setRecSeconds(0);
    setRecLevels([]);
  };

  const finishRecording = async () => {
    const rec = recorderRef.current;
    if (!rec) return;
    recorderRef.current = null;
    setRecording(false);
    setRecSeconds(0);
    setRecLevels([]);
    const note = await rec.stop();
    // A tap that was not meant as a recording returns null rather than an
    // empty bubble.
    if (!note) return;
    await sendMessage("", undefined, {
      blob: note.blob, mimeType: note.mimeType, seconds: note.seconds, levels: note.levels,
    });
    URL.revokeObjectURL(note.preview);
  };

  /* Tick the timer and the live waveform while recording. One interval, not a
     render loop: the button only needs to move a few times a second. */
  useEffect(() => {
    if (!recording) return undefined;
    const id = window.setInterval(() => {
      const rec = recorderRef.current;
      if (!rec) return;
      setRecSeconds(rec.elapsed());
      setRecLevels((prev) => [...prev.slice(-40), rec.level()]);
    }, 120);
    return () => window.clearInterval(id);
  }, [recording]);

  /* A half-finished recording must not outlive the screen — the microphone
     indicator would stay lit with nothing listening. */
  useEffect(() => () => { recorderRef.current?.cancel(); audioRef.current?.pause(); }, []);

  const playVoice = (id: string, url: string) => {
    if (playingId === id) { audioRef.current?.pause(); setPlayingId(null); return; }
    audioRef.current?.pause();
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => setPlayingId(null);
    audio.onerror = () => setPlayingId(null);
    void audio.play().then(() => setPlayingId(id)).catch(() => setPlayingId(null));
  };

  // WhatsApp-style group creation: choose people first, name it, then create.
  // It used to make a thread called "New Driver Group" the instant the button
  // was pressed — a ready-made room with nobody in it.
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupPicks, setGroupPicks] = useState<string[]>([]);
  const [membersOpen, setMembersOpen] = useState(false);
  const connections = useCommunityStore((state) => state.connections);

  // Only people who actually accepted a connection. You cannot add a stranger
  // to a group chat.
  const friends = useMemo(
    () => workers.filter((w) => connectionFor(connections, user?.id, w.id).state === "connected"),
    [workers, connections, user],
  );

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

  /* Chats with something unread, not messages.
     This summed unreadCount across threads, so two chats holding two and five
     messages showed "7" on a chip that then filtered the list down to two rows.
     The number on a filter has to count the same things the filter selects. The
     per-row badges still count messages, which is the right unit there. */
  const unreadTotal = threads.filter((thread) => (thread.unreadCount || 0) > 0).length;

  const chatList = [...threads]
    .filter((thread) => displayTitle(thread).toLowerCase().includes(query.toLowerCase()))
    .filter((thread) =>
      chatFilter === "unread" ? thread.unreadCount > 0
      : chatFilter === "groups" ? thread.isGroup
      : true,
    )
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
    await sendMessage(draft.trim() || t("wa_photoMsg"), attachment, undefined, replyTo ?? undefined);
    setDraft("");
    setAttachment(undefined);
    setReplyTo(null);
  };

  /** Whichever id this device writes as. The store uses the same rule, so a
   *  chip knows it is yours in both cloud and local modes. */
  const meId = SupabaseService.enabled ? user?.id ?? "me" : "me";

  const clock = (ts: number) =>
    new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <main className="page-shell wa-page has-band">
      {/* Search sits on the band, where every messaging app a driver already
          uses puts it — in the coloured header, not floating on a white page
          under a black title. */}
      <section className="screen-band wa-band">
        <div className="wa-search input-shell">
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("wa_searchChats")}
          />
        </div>

        {/* All / Unread / Groups. A driver with thirty chats and two unread ones
            should not have to scroll to find them, which is the whole reason
            these exist in the app this is modelled on. */}
        <div className="wa-filters">
          {(["all", "unread", "groups"] as const).map((f) => (
            <button
              key={f}
              className={chatFilter === f ? "is-on" : ""}
              onClick={() => setChatFilter(f)}
            >
              {t(f === "all" ? "wa_filterAll" : f === "unread" ? "wa_filterUnread" : "wa_filterGroups")}
              {f === "unread" && unreadTotal ? <em>{unreadTotal}</em> : null}
            </button>
          ))}
        </div>
      </section>

      <button className="wa-newgroup" onClick={() => { setGroupPicks([]); setGroupName(""); setGroupOpen(true); }}>
        <span className="wa-avatar wa-avatar-accent"><UsersRound size={20} /></span>
        {t("wa_newGroup")}
      </button>

      <Modal
        open={groupOpen}
        onClose={() => setGroupOpen(false)}
        title={t("wa_newGroup")}
        description={friends.length ? t("wa_groupPick") : t("wa_groupNoFriends")}
      >
        <div className="wa-group-builder">
          {friends.length === 0 ? (
            <p className="wa-group-empty">{t("wa_groupNoFriendsBody")}</p>
          ) : (
            <>
              <ul className="wa-group-friends">
                {friends.map((f) => {
                  const picked = groupPicks.includes(f.id);
                  return (
                    <li key={f.id}>
                      <button
                        type="button"
                        className={picked ? "wa-group-friend is-picked" : "wa-group-friend"}
                        onClick={() =>
                          setGroupPicks((prev) =>
                            prev.includes(f.id) ? prev.filter((x) => x !== f.id) : [...prev, f.id],
                          )
                        }
                      >
                        <span className="wa-avatar">{initials(f.name)}</span>
                        <span className="wa-group-friend-name">{f.name}</span>
                        <span className="wa-group-check">{picked ? "✓" : ""}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              <input
                className="wa-group-name"
                placeholder={t("wa_groupName")}
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
              />

              <Button
                disabled={groupPicks.length === 0}
                onClick={async () => {
                  await createGroup(groupName, groupPicks);
                  setGroupOpen(false);
                }}
              >
                {groupPicks.length
                  ? `${t("wa_groupCreate")} (${groupPicks.length})`
                  : t("wa_groupCreate")}
              </Button>
            </>
          )}
        </div>
      </Modal>

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
                  <p className="wa-preview">
                    {/* The ticks belong in the preview, not only inside the
                        thread. Whether the last thing you said has been read is
                        the question this list gets asked most often. */}
                    {last && mine ? (
                      <span className={`wa-ticks ${last.status === "read" ? "read" : ""}`}>
                        {last.status === "sent" ? "✓" : "✓✓"}
                      </span>
                    ) : null}
                    {/* Only when there is text beside the photo. The fallback
                        label already carries its own 📷, and rendering both put
                        two picture glyphs in a row. */}
                    {last?.attachmentUrl && last.body ? (
                      <ImagePlus size={13} className="wa-preview-icon" />
                    ) : null}
                    <span className="wa-preview-text">
                      {last ? last.body || t("wa_photoMsg") : t("wa_tapToStart")}
                    </span>
                  </p>
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
            <div
              className={openThread.isGroup ? "wa-convo-title is-tappable" : "wa-convo-title"}
              onClick={() => { if (openThread.isGroup) setMembersOpen(true); }}
              role={openThread.isGroup ? "button" : undefined}
              tabIndex={openThread.isGroup ? 0 : undefined}
            >
              <strong>{displayTitle(openThread)}</strong>
              {/* Presence is unknown until the other driver's profile loads.
                  Render nothing rather than an empty line, which otherwise
                  leaves a blank gap under the name. */}
              {(() => {
                // Name the first few and count the rest. A group of nine would
                // otherwise render a line of names that the header simply clips,
                // which tells the driver less than a number does.
                const names = openThread.isGroup
                  ? openThread.participantIds
                      .map((id) => (id === user?.id ? t("wa_you") : workerById[id]?.name))
                      .filter(Boolean)
                  : [];
                const SHOWN = 3;
                const memberNames = names.length
                  ? names.length > SHOWN
                    ? `${names.slice(0, SHOWN).join(", ")} ${t("wa_andMore", { count: String(names.length - SHOWN) })}`
                    : names.join(", ")
                  : "";
                const line = openThread.isGroup
                  ? memberNames || t("wa_groupChat")
                  : presenceLabel(openOther, t);
                if (!line) return null;
                return (
                  <small className={!openThread.isGroup && openOther?.isOnline ? "wa-online" : ""}>
                    {line}
                  </small>
                );
              })()}
            </div>
            {/* Only shown for groups. A one-to-one chat has nothing to offer
                here, and a menu that opens onto nothing is worse than no menu —
                which is what this button was until now: no handler at all. */}
            {openThread.isGroup ? (
              <button
                type="button"
                className="wa-back"
                aria-label={t("a11y_options")}
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
              >
                <MoreVertical size={20} />
              </button>
            ) : (
              <span className="wa-header-spacer" />
            )}
          </header>

          {/* Group actions. One entry, because one action exists — leaving.
              Anything else here would be a button that does nothing, which is
              what we are removing, not adding more of. */}
          {menuOpen ? (
            <>
              <button
                type="button"
                className="wa-menu-scrim"
                aria-label={t("a11y_close")}
                onClick={() => setMenuOpen(false)}
              />
              <div className="wa-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className="wa-menu-item"
                  onClick={() => { setMenuOpen(false); setMembersOpen(true); }}
                >
                  <UsersRound size={16} /> {t("wa_viewMembers")}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="wa-menu-item danger"
                  onClick={() => { setMenuOpen(false); setConfirmLeave(true); }}
                >
                  <LogOut size={16} /> {t("wa_leaveGroup")}
                </button>
              </div>
            </>
          ) : null}

          <div className="wa-messages" ref={messagesRef}>
            {/* WhatsApp opens a thread with an end-to-end encryption notice.
                Buzz is not end-to-end encrypted — messages sit in Postgres where
                row-level security decides who may read them, which is a real
                protection and a different one. Writing "encrypted" here because
                it looks reassuring would be the worst kind of lie to tell in a
                chat app, so this says what is actually true. */}
            <p className="wa-privacy-note">{t("wa_privacyNote")}</p>
            {openMessages.length ? (
              openMessages.map((message, index) => {
                const isMe = message.senderId === "me" || message.senderId === user?.id;
                const sender = workerById[message.senderId]?.name ?? "Driver";
                // In a one-to-one chat the other person's id is often not in
                // workerById — they are a contact, not a nearby driver — and the
                // quote said "Driver" above their own words. The thread title is
                // their name, and in a DM there is only one other person it can
                // belong to, so it is the right fallback. Groups keep "Driver",
                // where the title is the group's name and would be a lie.
                const nameFor = (id: string) =>
                  id === "me" || id === user?.id
                    ? t("wa_you")
                    : workerById[id]?.name ??
                      (openThread.isGroup ? "Driver" : openThread.title);
                const showSender =
                  openThread.isGroup && !isMe && openMessages[index - 1]?.senderId !== message.senderId;
                // A divider whenever the day changes. Without one, a thread read
                // the next morning shows yesterday's messages as though they had
                // just arrived.
                const prev = openMessages[index - 1];
                const newDay =
                  !prev ||
                  new Date(prev.createdAt).toDateString() !== new Date(message.createdAt).toDateString();
                return (
                  /* The delete control is a SIBLING of the bubble, not a child.
                     It used to be absolutely positioned inside it, so on touch —
                     where it is always visible, there being no hover — it sat on
                     top of the driver's own words. */
                  <Fragment key={message.id}>
                  {newDay ? (
                    <div className="wa-daysep"><span>{dayLabel(message.createdAt, t)}</span></div>
                  ) : null}
                  <div className={`wa-row ${isMe ? "me" : ""}`} id={`msg-${message.id}`}>
                    {/* Siblings of the bubble, for the same reason the delete
                        button is: on touch there is no hover, so anything
                        positioned inside the bubble sits on top of the words. */}
                    <div className="wa-acts">
                      <button
                        type="button"
                        className="wa-act"
                        aria-label={t("wa_reply")}
                        onClick={() => setReplyTo(message.id)}
                      >
                        <CornerUpLeft size={15} />
                      </button>
                      <button
                        type="button"
                        className="wa-act"
                        aria-label={t("wa_react")}
                        aria-expanded={pickerFor === message.id}
                        onClick={() =>
                          setPickerFor((open) => (open === message.id ? null : message.id))
                        }
                      >
                        <SmilePlus size={15} />
                      </button>
                      {/* Only your own messages can be removed (RLS enforces it too). */}
                      {isMe ? (
                        <button
                          type="button"
                          className="wa-act"
                          aria-label={t("wa_deleteMessage")}
                          onClick={() => setConfirmDelete(message.id)}
                        >
                          <Trash2 size={15} />
                        </button>
                      ) : null}
                    </div>
                    <div className={`wa-bubble ${isMe ? "me" : ""}`}>
                    {/* The quote is resolved from the live message list rather
                        than copied at send time, so an edit shows through and a
                        delete degrades to a line of text instead of a bubble
                        quoting something that no longer exists. */}
                    {message.replyToId ? (
                      (() => {
                        const q = messages.find((m) => m.id === message.replyToId);
                        if (!q) return <div className="wa-quote is-gone">{t("wa_originalGone")}</div>;
                        return (
                          <button
                            type="button"
                            className="wa-quote"
                            onClick={() => {
                              document
                                .getElementById(`msg-${q.id}`)
                                ?.scrollIntoView({ behavior: "smooth", block: "center" });
                            }}
                          >
                            <span className="wa-quote-who">{nameFor(q.senderId)}</span>
                            <span className="wa-quote-body">
                              {q.voiceUrl ? t("wa_voiceNote") : q.body || t("wa_photoMsg")}
                            </span>
                          </button>
                        );
                      })()
                    ) : null}
                    {showSender ? <span className="wa-sender">{sender}</span> : null}
                    {message.attachmentUrl ? (
                      /* Thumbnail in the bubble; the full file is only fetched
                         if the driver taps it. Older messages have no thumbnail
                         because the image is inline in the row. */
                      <img
                        className="wa-image"
                        src={message.attachmentThumbUrl ?? message.attachmentUrl}
                        alt="Attachment"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : null}
                    {/* A voice note. The waveform is drawn from levels captured
                        while recording, so it appears immediately rather than
                        after downloading and decoding the audio — on a driver's
                        connection that is the difference between a chat that
                        renders and one that hangs. */}
                    {message.voiceUrl ? (
                      <button
                        type="button"
                        className={`wa-voice${playingId === message.id ? " is-playing" : ""}`}
                        onClick={() => playVoice(message.id, message.voiceUrl!)}
                        aria-label={t("wa_voiceNote")}
                      >
                        {playingId === message.id ? <Pause size={16} /> : <Play size={16} />}
                        <span className="wa-voice-wave">
                          {waveform(message.voiceLevels ?? []).map((v, i) => (
                            <i key={i} style={{ height: `${Math.round(4 + v * 16)}px` }} />
                          ))}
                        </span>
                        <small>{clockOf(message.voiceSeconds ?? 0)}</small>
                      </button>
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
                    {/* Chips hang under the bubble, one per emoji with a count.
                        Yours is outlined so you can see at a glance which one
                        you gave without counting. */}
                    {message.reactions && Object.keys(message.reactions).length ? (
                      <div className="wa-reacts">
                        {Object.entries(message.reactions).map(([emoji, ids]) => (
                          <button
                            type="button"
                            key={emoji}
                            className={`wa-react-chip${ids.includes(meId) ? " is-mine" : ""}`}
                            onClick={() => void toggleReaction(message.id, emoji)}
                          >
                            <span aria-hidden>{emoji}</span>
                            {ids.length > 1 ? <small>{ids.length}</small> : null}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {pickerFor === message.id ? (
                      <div className="wa-picker" role="group" aria-label={t("wa_reactions")}>
                        {REACTIONS.map((emoji) => (
                          <button
                            type="button"
                            key={emoji}
                            aria-label={emoji}
                            onClick={() => {
                              void toggleReaction(message.id, emoji);
                              setPickerFor(null);
                            }}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  </Fragment>
                );
              })
            ) : (
              <div className="wa-empty">{t("wa_noMessages")}</div>
            )}
          </div>

          {/* The photo you are about to send. It used to be invisible — the
              attach button turned orange and that was the whole feedback, so
              you could not tell WHICH photo was staged, or that one still was
              after typing a caption. The card shows the thumbnail, what it
              will be sent as after downscaling, and how much data that costs,
              which is not a detail to a driver on a prepaid plan. */}
          {attachment ? (
            <div className="wa-attach-card">
              <img src={attachment.preview} alt="" />
              <div>
                <strong>{t("wa_photoReady")}</strong>
                <span>
                  {attachment.width}&times;{attachment.height} &middot;{" "}
                  {attachment.bytes < 1024 * 1024
                    ? `${Math.max(1, Math.round(attachment.bytes / 1024))} KB`
                    : `${(attachment.bytes / (1024 * 1024)).toFixed(1)} MB`}
                </span>
              </div>
              <button
                type="button"
                aria-label={t("wa_removePhoto")}
                onClick={() => {
                  MediaService.releasePreview(attachment.preview);
                  setAttachment(undefined);
                }}
              >
                <X size={16} />
              </button>
            </div>
          ) : null}

          {/* What you are replying to, above the composer — the one place you
              are already looking while typing. Resolved live, so if the
              original is deleted mid-compose the banner closes itself rather
              than sending a reply pointing at nothing. */}
          {replyTo ? (
            (() => {
              const q = messages.find((m) => m.id === replyTo);
              if (!q) return null;
              const who = q.senderId === "me" || q.senderId === user?.id
                ? t("wa_you")
                : workerById[q.senderId]?.name ??
                  (openThread.isGroup ? "Driver" : openThread.title);
              return (
                <div className="wa-replybar">
                  <div>
                    <strong>{t("wa_replyingTo", { name: who })}</strong>
                    <span>{q.voiceUrl ? t("wa_voiceNote") : q.body || t("wa_photoMsg")}</span>
                  </div>
                  <button
                    type="button"
                    aria-label={t("wa_cancelReply")}
                    onClick={() => setReplyTo(null)}
                  >
                    <X size={16} />
                  </button>
                </div>
              );
            })()
          ) : null}

          <form className="wa-input" onSubmit={submit}>
            <button
              type="button"
              className={`wa-attach ${attachment ? "active" : ""}`}
              aria-label={t("a11y_attachPhoto")}
              onClick={async () => {
                if (attachment) {
                  MediaService.releasePreview(attachment.preview);
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
            {/* Mic when there is nothing to send, send when there is — one
                button, because a screen held one-handed on a bike has no room
                for both and no time to aim between them. */}
            {draft.trim() || attachment ? (
              <button type="submit" className="wa-send" aria-label={t("a11y_send")}>
                <Send size={18} />
              </button>
            ) : voiceOk ? (
              <button
                type="button"
                className={`wa-send wa-mic${recording ? " is-rec" : ""}`}
                aria-label={t("wa_holdToTalk")}
                // Pointer events, not mouse or touch: one code path for a
                // finger, a stylus and a desktop mouse, and it cannot fire twice
                // on a device that reports both.
                onPointerDown={(e) => { e.preventDefault(); void beginRecording(); }}
                onPointerUp={() => void finishRecording()}
                onPointerLeave={() => { if (recording) cancelRecording(); }}
                onPointerCancel={() => { if (recording) cancelRecording(); }}
              >
                <Mic size={18} />
              </button>
            ) : null}
          </form>

          {/* While recording: how long, how loud, and the way out. Someone who
              started this by accident needs a cancel they can hit without
              looking at the screen. */}
          {recording ? (
            <div className="wa-rec">
              <button type="button" className="wa-rec-cancel" onClick={cancelRecording}>
                <Trash2 size={16} /> {t("sv_cancel")}
              </button>
              <span className="wa-rec-wave">
                {recLevels.slice(-24).map((v, i) => (
                  <i key={i} style={{ height: `${Math.round(6 + v * 20)}px` }} />
                ))}
              </span>
              <b>{clockOf(recSeconds)}</b>
            </div>
          ) : null}

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

          {openThread?.isGroup ? (
            <Modal
              open={membersOpen}
              onClose={() => setMembersOpen(false)}
              title={displayTitle(openThread)}
              description={t("wa_membersCount", { count: String(openThread.participantIds.length) })}
            >
              <ul className="wa-members">
                {openThread.participantIds.map((id) => {
                  const isMe = id === user?.id;
                  const name = isMe ? t("wa_you") : workerById[id]?.name ?? t("wa_unknownMember");
                  return (
                    <li key={id}>
                      <span className="wa-avatar">{initials(name)}</span>
                      <span className="wa-member-name">{name}</span>
                    </li>
                  );
                })}
              </ul>
            </Modal>
          ) : null}

          {confirmLeave && openThread ? (
            <div className="wa-confirm-scrim" onClick={() => setConfirmLeave(false)}>
              <div className="wa-confirm" onClick={(event) => event.stopPropagation()}>
                <strong>{t("wa_leaveGroup")}</strong>
                <p>{t("wa_leaveGroupSure", { name: openThread.title })}</p>
                <div className="wa-confirm-actions">
                  <button onClick={() => setConfirmLeave(false)}>{t("sv_cancel")}</button>
                  <button
                    className="wa-confirm-del"
                    onClick={() => {
                      const id = openThread.id;
                      setConfirmLeave(false);
                      setOpenId(null);
                      void leaveThread(id);
                    }}
                  >
                    {t("wa_leaveGroup")}
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
