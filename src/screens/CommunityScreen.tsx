import {
  Check,
  Clapperboard,
  ExternalLink,
  Facebook,
  Globe,
  Heart,
  Home,
  Image as ImageIcon,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  Send,
  Share2,
  Smile,
  Star,
  ThumbsUp,
  Trash2,
  UserPlus,
  Users,
  UsersRound,
  Wallet,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { FormEvent, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { Wordmark } from "../components/Wordmark";
import { MediaService } from "../services/MediaService";
import { useT } from "../i18n";
import { useAuthStore } from "../stores/useAuthStore";
import { useChatStore } from "../stores/useChatStore";
import { connectionFor, useCommunityStore } from "../stores/useCommunityStore";
import type { ConnectionState, Worker } from "../types";
import { currency, initials, km, timeAgo } from "../utils/format";
import { getWorkApp } from "../utils/workApps";

type FbTab = "home" | "reels" | "friends" | "groups";

const FEELINGS = ["😊 feeling happy", "🚗 on the road", "☕ taking a break", "💪 grinding", "🎯 hitting goals"];

export function CommunityScreen() {
  const navigate = useNavigate();
  const t = useT();
  const user = useAuthStore((state) => state.user);
  const posts = useCommunityStore((state) => state.posts);
  const loaded = useCommunityStore((state) => state.loaded);
  const workers = useCommunityStore((state) => state.workers);
  const groups = useCommunityStore((state) => state.groups);
  const groupsFromCloud = useCommunityStore((state) => state.groupsFromCloud);
  const comments = useCommunityStore((state) => state.comments);
  const connections = useCommunityStore((state) => state.connections);
  const addPost = useCommunityStore((state) => state.addPost);
  const toggleLike = useCommunityStore((state) => state.toggleLike);
  const deletePost = useCommunityStore((state) => state.deletePost);
  const loadComments = useCommunityStore((state) => state.loadComments);
  const addComment = useCommunityStore((state) => state.addComment);
  const sendConnection = useCommunityStore((state) => state.sendConnection);
  const acceptConnection = useCommunityStore((state) => state.acceptConnection);
  const toggleGroup = useCommunityStore((state) => state.toggleGroup);
  const openDirectThread = useChatStore((state) => state.openDirectThread);

  const messageDriver = async (workerId: string) => {
    await openDirectThread(workerId);
    navigate("/messages", {
      state: { openThreadId: useChatStore.getState().selectedThreadId },
    });
  };

  const [tab, setTab] = useState<FbTab>("home");
  const [postBody, setPostBody] = useState("");
  const [query, setQuery] = useState("");
  const [openComments, setOpenComments] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [selectedWorker, setSelectedWorker] = useState<Worker | null>(null);
  const [photo, setPhoto] = useState<string | undefined>();
  const [pickingPhoto, setPickingPhoto] = useState(false);
  const [tagged, setTagged] = useState<Worker[]>([]);
  const [tagOpen, setTagOpen] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [shareFb, setShareFb] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const firstName = user?.fullName.split(" ")[0] ?? "Driver";

  // Feed filtered by the search box (author or text) and any posts the user hid.
  const visiblePosts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return posts.filter(
      (post) =>
        !hidden.has(post.id) &&
        (!q || post.author.toLowerCase().includes(q) || (post.body ?? "").toLowerCase().includes(q)),
    );
  }, [posts, hidden, query]);

  const hidePost = (id: string) => setHidden((prev) => new Set(prev).add(id));

  const requests = useMemo(
    () => workers.filter((w) => connectionFor(connections, user?.id, w.id).state === "pending_in"),
    [connections, user?.id, workers],
  );
  const friends = useMemo(
    () => workers.filter((w) => connectionFor(connections, user?.id, w.id).state === "connected"),
    [connections, user?.id, workers],
  );
  const suggestions = useMemo(
    () =>
      workers.filter((w) => {
        const state = connectionFor(connections, user?.id, w.id).state;
        return (state === "none" || state === "pending_out") &&
          w.name.toLowerCase().includes(query.toLowerCase());
      }),
    [connections, query, user?.id, workers],
  );
  const reels = useMemo(() => posts.filter((p) => p.imageUrl), [posts]);

  const pickPhoto = async () => {
    setPickingPhoto(true);
    try {
      const url = await MediaService.pickImage();
      if (url) setPhoto(url);
    } finally {
      setPickingPhoto(false);
    }
  };

  const toggleTag = (worker: Worker) => {
    setTagged((prev) =>
      prev.some((t) => t.id === worker.id)
        ? prev.filter((t) => t.id !== worker.id)
        : [...prev, worker],
    );
  };

  const addFeeling = () => {
    const feeling = FEELINGS[Math.floor(Math.random() * FEELINGS.length)];
    setPostBody((prev) => (prev.trim() ? `${prev.trim()} — ${feeling}` : `${firstName} is ${feeling}`));
  };

  const submitPost = (event: FormEvent) => {
    event.preventDefault();
    const text = postBody.trim();
    if (!text && !photo) return;
    const withTags = tagged.length
      ? `${text}${text ? " " : ""}— with ${tagged.map((t) => t.name).join(", ")}`
      : text;
    addPost(withTags, photo);
    // Cross-post: open Facebook's own share flow so the driver can post the same
    // update to their Facebook timeline or a group (Meta no longer lets apps post
    // into a group directly — the user taps "Post" in Facebook themselves).
    if (shareFb && withTags) shareToFacebook(withTags);
    setPostBody("");
    setPhoto(undefined);
    setTagged([]);
  };

  const toggleCommentSection = (postId: string) => {
    if (openComments === postId) {
      setOpenComments(null);
      return;
    }
    setOpenComments(postId);
    setCommentDraft("");
    void loadComments(postId);
  };

  const submitComment = (event: FormEvent, postId: string) => {
    event.preventDefault();
    if (!commentDraft.trim()) return;
    void addComment(postId, commentDraft.trim());
    setCommentDraft("");
  };

  return (
    <main className="page-shell fb-page">
      {/* Facebook-style top bar */}
      <div className="fb-topbar">
        <Wordmark size={22} className="fb-wordmark" />
        <div className="fb-search">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("fb_search")}
          />
        </div>
        <button className="fb-round" aria-label="Messenger" onClick={() => navigate("/messages")}>
          <MessageCircle size={20} />
        </button>
      </div>

      {/* Facebook top navigation tabs */}
      <nav className="fb-tabs" role="tablist">
        <FbTabButton active={tab === "home"} onClick={() => setTab("home")} icon={<Home size={22} />} label={t("nav_home")} />
        <FbTabButton active={tab === "reels"} onClick={() => setTab("reels")} icon={<Clapperboard size={22} />} label={t("fb_reels")} />
        <FbTabButton
          active={tab === "friends"}
          onClick={() => setTab("friends")}
          icon={<UsersRound size={22} />}
          label={t("fb_friends")}
          badge={requests.length}
        />
        <FbTabButton active={tab === "groups"} onClick={() => setTab("groups")} icon={<Users size={22} />} label={t("fb_groups")} />
      </nav>

      {tab === "home" ? (
        <div className="fb-body">
          {/* Stories */}
          <div className="fb-stories">
            <button className="fb-story fb-story-create" onClick={() => void pickPhoto()}>
              <span className="fb-story-avatar">{initials(user?.fullName ?? "You")}</span>
              <span className="fb-story-plus"><Plus size={16} /></span>
              <span className="fb-story-label">{t("fb_createStory")}</span>
            </button>
            {workers.slice(0, 10).map((worker) => (
              <button className="fb-story" key={worker.id} onClick={() => setSelectedWorker(worker)}>
                <span
                  className="fb-story-bg"
                  style={{ background: `linear-gradient(160deg, ${getWorkApp(worker.app)?.color ?? "#1877f2"}, #050505)` }}
                >
                  <span className="fb-story-ring">{initials(worker.name)}</span>
                </span>
                <span className="fb-story-name">{worker.name.split(" ")[0]}</span>
              </button>
            ))}
          </div>

          {/* Composer */}
          <form className="fb-composer" onSubmit={submitPost}>
            <div className="fb-composer-row">
              <span className="fb-avatar">{initials(user?.fullName ?? "Driver")}</span>
              <textarea
                value={postBody}
                onChange={(event) => setPostBody(event.target.value)}
                placeholder={t("fb_whatsOnMind", { name: firstName })}
                rows={1}
              />
            </div>
            {photo ? (
              <div className="fb-composer-photo">
                <img src={photo} alt="Selected attachment" />
                <button type="button" aria-label="Remove photo" onClick={() => setPhoto(undefined)}>
                  <X size={16} />
                </button>
              </div>
            ) : null}
            {tagged.length ? (
              <div className="fb-composer-tags">
                {tagged.map((t) => (
                  <span className="fb-tag-chip" key={t.id}>
                    @{t.name}
                    <button type="button" onClick={() => toggleTag(t)} aria-label={`Remove ${t.name}`}>
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <div className="fb-composer-divider" />
            <div className="fb-composer-actions">
              <button type="button" className="fb-ca-photo" onClick={() => void pickPhoto()} disabled={pickingPhoto}>
                <ImageIcon size={19} /> {pickingPhoto ? "…" : t("fb_photo")}
              </button>
              <button type="button" className="fb-ca-tag" onClick={() => setTagOpen(true)}>
                <UsersRound size={19} /> {t("fb_tag")}
              </button>
              <button type="button" className="fb-ca-feeling" onClick={addFeeling}>
                <Smile size={19} /> {t("fb_feeling")}
              </button>
            </div>
            {postBody.trim() || photo ? (
              <>
                <button
                  type="button"
                  className={`fb-crosspost ${shareFb ? "on" : ""}`}
                  onClick={() => setShareFb((v) => !v)}
                  aria-pressed={shareFb}
                >
                  <span className="fb-crosspost-fb"><Facebook size={16} /></span>
                  <span className="fb-crosspost-label">
                    <strong>{t("fb_alsoShareFb")}</strong>
                    <small>{t("fb_alsoShareFbHint")}</small>
                  </span>
                  <span className={`fb-crosspost-switch ${shareFb ? "on" : ""}`} />
                </button>
                <Button className="fb-post-btn" disabled={!postBody.trim() && !photo}>{t("fb_post")}</Button>
              </>
            ) : null}
          </form>

          {/* Feed */}
          {!loaded && !posts.length ? (
            <FeedSkeleton />
          ) : visiblePosts.length ? (
            visiblePosts.map((post) => (
              <article className="fb-post" key={post.id}>
                <div className="fb-post-head">
                  <span className="fb-avatar">{post.initials}</span>
                  <div className="fb-post-meta">
                    <strong>{post.author}</strong>
                    <p>{timeAgo(post.createdAt)} · <Globe size={12} /></p>
                  </div>
                  {/* Your own post can be genuinely deleted; someone else's can
                      only be hidden from your own feed. */}
                  {post.userId && post.userId === user?.id ? (
                    <button
                      className="fb-post-more"
                      aria-label={t("fb_deletePost")}
                      onClick={() => setConfirmDelete(post.id)}
                    >
                      <Trash2 size={18} />
                    </button>
                  ) : (
                    <button className="fb-post-more" aria-label={t("fb_hidePost")} onClick={() => hidePost(post.id)}>
                      <MoreHorizontal size={20} />
                    </button>
                  )}
                </div>
                {post.body ? <p className="fb-post-body">{post.body}</p> : null}
                {post.imageUrl ? (
                  <img className="fb-post-image" src={post.imageUrl} alt="Shared attachment" loading="lazy" />
                ) : null}
                {post.likes || post.commentCount ? (
                  <div className="fb-post-stats">
                    <span className="fb-like-bubble"><ThumbsUp size={11} /></span>
                    {post.likes ? <span>{post.likes}</span> : null}
                    {post.commentCount ? (
                      <span className="fb-stats-comments">
                        {post.commentCount} comment{post.commentCount > 1 ? "s" : ""}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                <div className="fb-post-actions">
                  <button className={post.likedByMe ? "active" : ""} onClick={() => toggleLike(post.id)}>
                    <ThumbsUp size={19} /> {t("fb_like")}
                  </button>
                  <button className={openComments === post.id ? "active" : ""} onClick={() => toggleCommentSection(post.id)}>
                    <MessageCircle size={19} /> {t("fb_comment")}
                  </button>
                  <button onClick={() => sharePost(post.body)}>
                    <Share2 size={19} /> {t("fb_share")}
                  </button>
                </div>

                {openComments === post.id ? (
                  <div className="fb-comments">
                    {(comments[post.id] ?? []).map((comment) => (
                      <div className="fb-comment" key={comment.id}>
                        <span className="fb-avatar sm">{comment.initials}</span>
                        <div className="fb-comment-bubble">
                          <strong>{comment.author}</strong>
                          <p>{comment.body}</p>
                        </div>
                      </div>
                    ))}
                    {!(comments[post.id] ?? []).length ? (
                      <p className="fb-comment-empty">{t("fb_firstComment")}</p>
                    ) : null}
                    <form className="fb-comment-form" onSubmit={(event) => submitComment(event, post.id)}>
                      <span className="fb-avatar sm">{initials(user?.fullName ?? "Driver")}</span>
                      <input
                        value={commentDraft}
                        onChange={(event) => setCommentDraft(event.target.value)}
                        placeholder={t("fb_writeComment")}
                      />
                      <button type="submit" aria-label="Send comment" disabled={!commentDraft.trim()}>
                        <Send size={17} />
                      </button>
                    </form>
                  </div>
                ) : null}
              </article>
            ))
          ) : (
            <div className="fb-empty">
              <MessageCircle size={34} />
              <p>{t("fb_noPosts")}</p>
              <span>{t("fb_noPostsSub")}</span>
            </div>
          )}
        </div>
      ) : null}

      {tab === "reels" ? (
        <div className="fb-body">
          {reels.length ? (
            <div className="fb-reels">
              {reels.map((reel) => (
                <article className="fb-reel" key={reel.id}>
                  <img src={reel.imageUrl} alt="" loading="lazy" />
                  <span className="fb-reel-play"><Play size={20} fill="currentColor" /></span>
                  <div className="fb-reel-overlay">
                    <strong>{reel.author}</strong>
                    <span className="fb-reel-likes"><Heart size={13} fill="currentColor" /> {reel.likes}</span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="fb-empty">
              <Clapperboard size={34} />
              <p>{t("fb_noReels")}</p>
              <span>{t("fb_noReelsSub")}</span>
            </div>
          )}
        </div>
      ) : null}

      {tab === "friends" ? (
        <div className="fb-body">
          {requests.length ? (
            <section className="fb-card">
              <div className="fb-section-head">
                <h4>{t("fb_friendRequests")}</h4>
                <em>{requests.length}</em>
              </div>
              {requests.map((worker) => (
                <div className="fb-friend-row" key={worker.id}>
                  <button className="fb-friend-tap" onClick={() => setSelectedWorker(worker)}>
                    <span className="fb-avatar lg">{initials(worker.name)}</span>
                    <div>
                      <strong>{worker.name}</strong>
                      <p>{getWorkApp(worker.app)?.name ?? "Driver"}</p>
                    </div>
                  </button>
                  <div className="fb-friend-btns">
                    <Button
                      size="sm"
                      className="fb-confirm"
                      onClick={() => {
                        const c = connectionFor(connections, user?.id, worker.id).connection;
                        if (c) void acceptConnection(c.id);
                      }}
                    >
                      {t("fb_confirm")}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void messageDriver(worker.id)}>
                      {t("fb_message")}
                    </Button>
                  </div>
                </div>
              ))}
            </section>
          ) : null}

          <section className="fb-card">
            <div className="fb-section-head">
              <h4>{t("fb_peopleYouMayKnow")}</h4>
            </div>
            {suggestions.length ? (
              suggestions.map((worker) => {
                const state = connectionFor(connections, user?.id, worker.id).state;
                return (
                  <div className="fb-friend-row" key={worker.id}>
                    <button className="fb-friend-tap" onClick={() => setSelectedWorker(worker)}>
                      <span className="fb-avatar lg">{initials(worker.name)}</span>
                      <div>
                        <strong>{worker.name}</strong>
                        <p>{getWorkApp(worker.app)?.logo} {getWorkApp(worker.app)?.name} · {worker.rating.toFixed(1)} ★</p>
                      </div>
                    </button>
                    {state === "pending_out" ? (
                      <Button size="sm" variant="outline" disabled>{t("fb_requested")}</Button>
                    ) : (
                      <Button size="sm" className="fb-add" onClick={() => void sendConnection(worker.id)}>
                        <UserPlus size={15} /> {t("fb_add")}
                      </Button>
                    )}
                  </div>
                );
              })
            ) : (
              <p className="fb-comment-empty">No suggestions right now. More drivers will appear as they join.</p>
            )}
          </section>

          {friends.length ? (
            <section className="fb-card">
              <div className="fb-section-head">
                <h4>{t("fb_yourFriends")}</h4>
                <em>{friends.length}</em>
              </div>
              {friends.map((worker) => (
                <div className="fb-friend-row" key={worker.id}>
                  <button className="fb-friend-tap" onClick={() => setSelectedWorker(worker)}>
                    <span className="fb-avatar lg">{initials(worker.name)}</span>
                    <div>
                      <strong>{worker.name}</strong>
                      <p>{worker.isOnline ? "Online now" : "Offline"}</p>
                    </div>
                  </button>
                  <Button size="sm" variant="outline" onClick={() => void messageDriver(worker.id)}>
                    <MessageCircle size={15} /> {t("fb_message")}
                  </Button>
                </div>
              ))}
            </section>
          ) : null}
        </div>
      ) : null}

      {tab === "groups" ? (
        <div className="fb-body">
          <section className="fb-card">
            <div className="fb-section-head">
              <h4>{t("fb_discoverGroups")}</h4>
            </div>
            <p className="fb-groups-sub">{t("fb_groupsSub")}</p>
          </section>
          <div className="fb-groups">
            {groups.map((group) => (
              <article className="fb-group" key={group.id}>
                <div className="fb-group-cover" style={{ background: `linear-gradient(135deg, ${group.color}, #050505)` }}>
                  <span className="fb-group-icon">{group.icon}</span>
                </div>
                <div className="fb-group-info">
                  <strong>{group.name}</strong>
                  <p>{group.description}</p>
                  <small>
                    {groupsFromCloud
                      ? `${group.members.toLocaleString()} ${t("fb_members")}`
                      : t("fb_membersUnknown")}
                  </small>
                  <div className="fb-group-actions">
                    <Button
                      size="sm"
                      variant={group.joined ? "outline" : "primary"}
                      className={group.joined ? "" : "fb-join"}
                      onClick={() => toggleGroup(group.id)}
                    >
                      {group.joined ? <><Check size={15} /> {t("fb_joined")}</> : <><Plus size={15} /> {t("fb_joinGroup")}</>}
                    </Button>
                    <button
                      type="button"
                      className="fb-group-fb"
                      onClick={() => findGroupOnFacebook(group.name)}
                    >
                      <Facebook size={15} /> {t("fb_findOnFacebook")} <ExternalLink size={13} />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      ) : null}

      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title={t("fb_deletePost")}
        description={t("fb_deletePostSure")}
      >
        <div className="confirm-actions">
          <Button variant="outline" onClick={() => setConfirmDelete(null)}>
            {t("sv_cancel")}
          </Button>
          <Button
            className="danger-solid"
            onClick={() => {
              const id = confirmDelete;
              setConfirmDelete(null);
              if (id) void deletePost(id);
            }}
          >
            <Trash2 size={16} /> {t("fb_delete")}
          </Button>
        </div>
      </Modal>

      <Modal
        open={tagOpen}
        onClose={() => setTagOpen(false)}
        title={t("fb_tagPeople")}
        description=""
      >
        <div className="tag-picker">
          {workers.length ? (
            workers.map((w) => {
              const selected = tagged.some((t) => t.id === w.id);
              return (
                <button
                  type="button"
                  key={w.id}
                  className={`tag-option ${selected ? "selected" : ""}`}
                  onClick={() => toggleTag(w)}
                >
                  <span className="avatar small">{initials(w.name)}</span>
                  <strong>{w.name}</strong>
                  {selected ? <Check size={17} /> : null}
                </button>
              );
            })
          ) : (
            <p className="fb-comment-empty">No one to tag yet.</p>
          )}
          <Button className="tag-done" onClick={() => setTagOpen(false)}>
            {t("common_done")}{tagged.length ? ` (${tagged.length})` : ""}
          </Button>
        </div>
      </Modal>

      <WorkerProfileModal
        worker={selectedWorker}
        connectionState={selectedWorker ? connectionFor(connections, user?.id, selectedWorker.id) : { state: "none" }}
        onClose={() => setSelectedWorker(null)}
        onConnect={(id) => void sendConnection(id)}
        onAccept={(id) => void acceptConnection(id)}
        onMessage={() => {
          const id = selectedWorker?.id;
          setSelectedWorker(null);
          if (id) void messageDriver(id);
        }}
      />
    </main>
  );
}

function FeedSkeleton() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <article className="fb-post fb-skeleton" key={i}>
          <div className="fb-post-head">
            <span className="sk sk-avatar" />
            <div className="fb-post-meta">
              <span className="sk sk-line" style={{ width: "42%" }} />
              <span className="sk sk-line sk-sm" style={{ width: "26%" }} />
            </div>
          </div>
          <div style={{ padding: "8px 14px 12px" }}>
            <span className="sk sk-line" style={{ width: "90%" }} />
            <span className="sk sk-line" style={{ width: "70%", marginTop: 8 }} />
          </div>
          <div className="sk sk-image" />
        </article>
      ))}
    </>
  );
}

function ConnectAction({
  connectionState,
  onConnect,
  onAccept,
  onMessage,
}: {
  connectionState: { state: ConnectionState; connection?: { id: string } };
  onConnect: () => void;
  onAccept: (id: string) => void;
  onMessage: () => void;
}) {
  switch (connectionState.state) {
    case "connected":
      return (
        <Button size="sm" variant="outline" onClick={onMessage}>
          <MessageCircle size={15} /> Message
        </Button>
      );
    case "pending_out":
      return (
        <Button size="sm" variant="outline" disabled>
          Requested
        </Button>
      );
    case "pending_in":
      return (
        <Button size="sm" onClick={() => connectionState.connection && onAccept(connectionState.connection.id)}>
          <Check size={15} /> Confirm
        </Button>
      );
    default:
      return (
        <Button size="sm" onClick={onConnect}>
          <UserPlus size={15} /> Add Friend
        </Button>
      );
  }
}

function WorkerProfileModal({
  worker,
  connectionState,
  onClose,
  onConnect,
  onAccept,
  onMessage,
}: {
  worker: Worker | null;
  connectionState: { state: ConnectionState; connection?: { id: string } };
  onClose: () => void;
  onConnect: (id: string) => void;
  onAccept: (id: string) => void;
  onMessage: () => void;
}) {
  if (!worker) return null;
  const app = getWorkApp(worker.app);
  return (
    <Modal open={!!worker} onClose={onClose} title="Profile">
      <div className="worker-profile">
        <div className="worker-profile-head">
          <span className="avatar huge">{initials(worker.name)}<span className={worker.isOnline ? "" : "offline"} /></span>
          <h3>{worker.name}</h3>
          <p>{app?.logo} {app?.name} • {worker.isOnline ? "Online now" : "Offline"}</p>
        </div>
        <div className="worker-profile-stats">
          <ProfileStat icon={<Star size={18} />} value={worker.rating.toFixed(1)} label="rating" />
          <ProfileStat icon={<MapPin size={18} />} value={km(worker.distanceKm)} label="today" />
          <ProfileStat icon={<Wallet size={18} />} value={currency(worker.earnings)} label="earned" />
        </div>
        {worker.tags.length ? <div className="tag-row">{worker.tags.map((tag) => <span key={tag}>{tag}</span>)}</div> : null}
        <div className="worker-profile-action">
          <ConnectAction
            connectionState={connectionState}
            onConnect={() => onConnect(worker.id)}
            onAccept={onAccept}
            onMessage={onMessage}
          />
        </div>
      </div>
    </Modal>
  );
}

function ProfileStat({ icon, value, label }: { icon: ReactNode; value: string; label: string }) {
  return (
    <div className="stat-box">
      <span>{icon}</span>
      <strong>{value}</strong>
      <small>{label}</small>
    </div>
  );
}

function sharePost(body: string) {
  const data = { title: "Buzz Buzz", text: body };
  if (navigator.share) {
    void navigator.share(data).catch(() => undefined);
  } else if (navigator.clipboard) {
    void navigator.clipboard.writeText(body).catch(() => undefined);
  }
}

// Cross-post a Buzz Buzz update to Facebook. Meta shut down direct app-to-group
// posting in 2020, so the honest path is to hand the text to Facebook's own share
// flow: on a phone the native share sheet opens Facebook (timeline OR a group the
// user chooses); on desktop we open Facebook's web share dialog. Either way the
// driver confirms the post inside Facebook. We also copy the text so it can be
// pasted into a group composer that doesn't prefill.
function shareToFacebook(text: string) {
  if (navigator.clipboard) void navigator.clipboard.writeText(text).catch(() => undefined);
  if (navigator.share) {
    void navigator.share({ title: "Buzz Buzz", text }).catch(() => undefined);
    return;
  }
  const shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(
    "https://play.google.com/store",
  )}&quote=${encodeURIComponent(text)}`;
  window.open(shareUrl, "_blank", "noopener,noreferrer");
}

// Open a Facebook group search for this community's name so drivers can find and
// join the matching real Facebook group.
function findGroupOnFacebook(name: string) {
  const url = `https://www.facebook.com/search/groups/?q=${encodeURIComponent(name)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

function FbTabButton({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  badge?: number;
}) {
  return (
    <button className={`fb-tab ${active ? "active" : ""}`} onClick={onClick} role="tab" aria-selected={active}>
      <span className="fb-tab-icon">
        {icon}
        {badge ? <em>{badge}</em> : null}
      </span>
      <span className="fb-tab-label">{label}</span>
    </button>
  );
}
