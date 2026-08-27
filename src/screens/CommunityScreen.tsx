import {
  Check,
  Clapperboard,
  ExternalLink,
  Facebook,
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
  Repeat2,
  Trash2,
  UserPlus,
  Users,
  UsersRound,
  Wallet,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { ChallengeIcon } from "../components/ChallengeIcon";
import { APP_NAME } from "../config/constants";
import { useBrandBand } from "../hooks/useBrandBand";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { BeeMark } from "../components/Wordmark";
import { MediaService, type PickedPhoto, type PickedVideo } from "../services/MediaService";
import { SupabaseService } from "../services/SupabaseService";
import { useT, usePlural } from "../i18n";
import { useAuthStore } from "../stores/useAuthStore";
import { useChatStore } from "../stores/useChatStore";
import { connectionFor, useCommunityStore } from "../stores/useCommunityStore";
import type { ConnectionState, Worker } from "../types";
import { currency, initials, km, timeAgo } from "../utils/format";
import { isTrending, rankReels } from "../utils/reelRank";
import { getWorkApp } from "../utils/workApps";

type FbTab = "home" | "reels" | "friends" | "groups";

/**
 * A display handle for the timeline, derived from the driver's name.
 *
 * Drivers do not choose a username — they sign up with a phone number — so this
 * is presentation only and never an identifier. Non-Latin names would reduce to
 * an empty string, which would read as a bare "@", so those keep their name as
 * written rather than being mangled into nothing.
 */
function handleOf(name: string): string {
  const latin = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return latin || name.trim().replace(/\s+/g, "");
}

const FEELINGS = ["😊 feeling happy", "🚗 on the road", "☕ taking a break", "💪 grinding", "🎯 hitting goals"];

export function CommunityScreen() {
  useBrandBand("community");
  const navigate = useNavigate();

  const t = useT();
  const plural = usePlural();
  const user = useAuthStore((state) => state.user);
  const posts = useCommunityStore((state) => state.posts);
  const loadCloudCommunity = useCommunityStore((state) => state.loadCloudCommunity);
  const loaded = useCommunityStore((state) => state.loaded);
  const workers = useCommunityStore((state) => state.workers);
  const groups = useCommunityStore((state) => state.groups);
  const groupsFromCloud = useCommunityStore((state) => state.groupsFromCloud);
  const comments = useCommunityStore((state) => state.comments);
  const connections = useCommunityStore((state) => state.connections);
  const addPost = useCommunityStore((state) => state.addPost);
  const toggleLike = useCommunityStore((state) => state.toggleLike);
  const toggleRepost = useCommunityStore((state) => state.toggleRepost);
  const deletePost = useCommunityStore((state) => state.deletePost);
  const loadComments = useCommunityStore((state) => state.loadComments);
  const addComment = useCommunityStore((state) => state.addComment);
  const sendConnection = useCommunityStore((state) => state.sendConnection);
  const acceptConnection = useCommunityStore((state) => state.acceptConnection);

  // Keep the feed current while it is open.
  //
  // MessagesScreen and RoutesScreen both refresh community data on a timer;
  // this screen — the one whose whole purpose is the shared feed — did not,
  // and relied entirely on the realtime subscription in App. A driver watching
  // the feed saw nothing new until they left and came back. Verified with two
  // drivers: a post from one stayed invisible to the other for 20s+ on an open
  // Community screen, then appeared immediately on reload.
  useEffect(() => {
    if (!user || !SupabaseService.enabled) return undefined;
    const timer = window.setInterval(() => void loadCloudCommunity(), 15000);
    return () => window.clearInterval(timer);
  }, [user, loadCloudCommunity]);
  const toggleGroup = useCommunityStore((state) => state.toggleGroup);
  const openDirectThread = useChatStore((state) => state.openDirectThread);
  /** Chats with something unread — the count of PEOPLE waiting, not messages,
   *  because a badge reading 47 for one talkative driver tells you nothing. */
  const unreadChats = useChatStore(
    (state) => state.threads.filter((thread) => thread.unreadCount > 0).length,
  );

  const messageDriver = async (workerId: string) => {
    await openDirectThread(workerId);
    navigate("/messages", {
      state: { openThreadId: useChatStore.getState().selectedThreadId },
    });
  };

  const [tab, setTab] = useState<FbTab>("home");
  const [postBody, setPostBody] = useState("");
  const [query, setQuery] = useState("");
  // People matching the search box. Searched on the server rather than filtered
  // out of `workers`, which is capped at 500 profiles — past that a local filter
  // would quietly stop finding drivers who do exist.
  const [peopleResults, setPeopleResults] = useState<Worker[]>([]);
  const [peopleSearching, setPeopleSearching] = useState(false);
  const [openComments, setOpenComments] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [selectedWorker, setSelectedWorker] = useState<Worker | null>(null);
  const [photo, setPhoto] = useState<PickedPhoto | undefined>();

  // Posting a reel deliberately, rather than a reel being whatever post
  // happened to carry a photo. A reel needs an image, so the picker comes
  // first and the caption second.
  const [reelOpen, setReelOpen] = useState(false);
  const [reelVideo, setReelVideo] = useState<PickedVideo | undefined>();
  const [reelError, setReelError] = useState<string | null>(null);
  const [reelCaption, setReelCaption] = useState("");
  const [pickingPhoto, setPickingPhoto] = useState(false);
  const [tagged, setTagged] = useState<Worker[]>([]);
  const [tagOpen, setTagOpen] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [shareFb, setShareFb] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  /* The compose button floats over the timeline. It does not open a second
     way to write a post — it brings the driver to the one that is already
     at the top, because two composers means two places a half-written post
     can be lost. */
  /** The search field shares its row with the page title, so it opens over
   *  the row rather than competing with it for width. */
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const composerRef = useRef<HTMLFormElement | null>(null);
  const jumpToComposer = () => {
    setComposeOpen(true);
    // After the sheet has mounted, not with it — there is nothing to focus yet
    // on the tick the state changes.
    window.setTimeout(() => {
      composerRef.current?.querySelector<HTMLElement>("textarea, input")?.focus();
    }, 60);
  };
  /** The compose sheet. There is still exactly ONE composer — it moved into a
   *  sheet rather than being duplicated, so a half-written post has only one
   *  place it can live. */
  const [composeOpen, setComposeOpen] = useState(false);
  // Full-size image is fetched only when a photo is tapped.
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);

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

  // Debounced people search. Every keystroke would otherwise be a round trip,
  // and a slow reply for "ma" must never land after the reply for "maria" and
  // overwrite it — hence the cancelled flag.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setPeopleResults([]);
      setPeopleSearching(false);
      return;
    }
    let cancelled = false;
    setPeopleSearching(true);
    const timer = setTimeout(() => {
      void SupabaseService.searchWorkers(term, user?.id)
        .then((found) => {
          if (!cancelled) setPeopleResults(found);
        })
        .catch(() => {
          if (!cancelled) setPeopleResults([]);
        })
        .finally(() => {
          if (!cancelled) setPeopleSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, user?.id]);

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
  // A reel is a video. Photo posts belong in the feed, not here — showing them
  // as reels is what made the tab misleading in the first place.
  //
  // Ordered by engagement decayed by age, so a good clip from this morning can
  // outrank an older one that has simply accumulated likes. See utils/reelRank.
  const reels = useMemo(() => rankReels(posts, user?.id), [posts, user?.id]);

  const pickPhoto = async () => {
    setPickingPhoto(true);
    try {
      const picked = await MediaService.pickImage();
      if (picked) setPhoto(picked);
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

  const pickReelVideo = async () => {
    const result = await MediaService.pickVideo();
    if (result.ok) {
      setReelError(null);
      setReelVideo(result.video);
      return;
    }
    // Say WHICH limit was hit. "Could not add that" leaves the driver guessing
    // whether to trim the clip or pick a different one.
    if (result.reason === "tooBig") setReelError(t("fb_reelTooBig"));
    else if (result.reason === "tooLong") setReelError(t("fb_reelTooLong"));
  };

  const shareReel = () => {
    if (!reelVideo) return;               // a reel is a video; without one it is just a post
    addPost(reelCaption.trim(), undefined, reelVideo);
    setReelVideo(undefined);
    setReelCaption("");
    setReelError(null);
    setReelOpen(false);
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
    setComposeOpen(false);
    // The store holds the blobs now; the composer can let its preview go.
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
      {/* Top bar.
          The page needs its name — every other screen says what it is, and
          this one showed a bee, a search field and four tab labels that could
          belong to anything. But a name, a mark, a search field and a button
          do not fit across 375px: adding the title squeezed the field to 87px,
          which rendered as "Sea".
          So the search collapses to a button and takes the whole row when it
          is opened. Nothing has to be sacrificed, and the field is wider when
          in use than it ever was before. */}
      <div className={`fb-topbar${searchOpen ? " is-searching" : ""}`}>
        <span className="fb-brand">
          <BeeMark size={30} className="fb-beemark" />
          <strong>{t("nav_community")}</strong>
        </span>
        <div className="fb-search">
          <Search size={17} />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("fb_search")}
          />
          {/* Closing clears, because leaving a stale query behind a collapsed
              button hides the reason the feed looks filtered. */}
          <button
            type="button"
            className="fb-search-close"
            aria-label={t("a11y_close")}
            onClick={() => { setQuery(""); setSearchOpen(false); }}
          >
            <X size={17} />
          </button>
        </div>
        {/* Both actions in one group, pinned to the right edge — which is
            where every app of this shape puts them, and where a right thumb
            reaches without crossing the screen. They were sitting 72px short
            of the corner because nothing pushed them there. */}
        <div className="fb-actions">
          <button
            className="fb-round fb-searchbtn"
            aria-label={t("fb_search")}
            onClick={() => {
              setSearchOpen(true);
              window.setTimeout(() => searchRef.current?.focus(), 60);
            }}
          >
            <Search size={19} />
          </button>
          <button
            className="fb-round"
            aria-label={t("a11y_messenger")}
            onClick={() => navigate("/messages")}
          >
            <MessageCircle size={20} />
            {/* Capped at 9+ so the badge stays a circle rather than growing
                into a pill and shoving the icon off-centre. */}
            {unreadChats > 0 ? (
              <span className="fb-round-badge">{unreadChats > 9 ? "9+" : unreadChats}</span>
            ) : null}
          </button>
        </div>
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
          {/* People matching the search box. Anyone registered shows up here,
              connected or not, and tapping a row opens their profile. */}
          {query.trim().length >= 2 ? (
            <section className="fb-card">
              <div className="fb-section-head">
                <h4>{t("fb_people")}</h4>
                {peopleResults.length ? <em>{peopleResults.length}</em> : null}
              </div>
              {peopleResults.length ? (
                peopleResults.map((worker) => (
                  <PersonRow
                    key={worker.id}
                    worker={worker}
                    state={connectionFor(connections, user?.id, worker.id).state}
                    t={t}
                    onOpen={() => setSelectedWorker(worker)}
                    onAdd={() => void sendConnection(worker.id)}
                    onMessage={() => void messageDriver(worker.id)}
                  />
                ))
              ) : (
                <p className="fb-comment-empty">
                  {peopleSearching ? `${t("fb_search")}…` : t("fb_noPeople")}
                </p>
              )}
            </section>
          ) : null}

          {/* The stories strip lived here. A timeline is a single column of
              posts, and a horizontal carousel of faces above it is the one
              piece of furniture that made this read as Facebook rather than
              Twitter. Profiles are still one tap away from any post or from
              search. */}

          {/* The composer used to sit at the top of the timeline. A box asking
              "What's happening?" above the feed, with a row of Photo / Tag /
              Feeling buttons under it, is the Facebook shape — the reference
              here is a timeline, which has no composer in it at all and a
              compose button instead.

              It is the same form, moved into a sheet, not a second one: two
              composers would mean two places a half-written post can be lost,
              which is why there was only ever one. */}
          <Modal
            open={composeOpen}
            title={t("fb_compose")}
            onClose={() => setComposeOpen(false)}
          >
          <form className="fb-composer" onSubmit={submitPost} ref={composerRef}>
            <div className="fb-composer-row">
              <span className="fb-avatar">{initials(user?.fullName ?? "Driver")}</span>
              <textarea
                value={postBody}
                onChange={(event) => setPostBody(event.target.value)}
                placeholder={t("tw_whatsHappening")}
                rows={1}
              />
            </div>
            {photo ? (
              <div className="fb-composer-photo">
                <img src={photo.preview} alt="Selected attachment" />
                <button type="button" aria-label={t("a11y_removePhoto")} onClick={() => { MediaService.releasePreview(photo?.preview); setPhoto(undefined); }}>
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
          </Modal>

          {/* Feed */}
          {!loaded && !posts.length ? (
            <FeedSkeleton />
          ) : visiblePosts.length ? (
            visiblePosts.map((post) => (
              <article className="tw-post" key={post.id}>
                <span className="tw-avatar">{post.initials}</span>
                <div className="tw-post-main">
                  <div className="tw-post-head">
                    {/* Name, handle and age on one line, the way a timeline
                        reads — the identity is the sentence, not a header. */}
                    <strong className="tw-name">{post.author}</strong>
                    <span className="tw-handle">@{handleOf(post.author)}</span>
                    <span className="tw-dot">·</span>
                    <span className="tw-time">{timeAgo(post.createdAt)}</span>
                    {post.pending ? <span className="pending-chip">{t("post_pending")}</span> : null}
                    {/* Your own post can be genuinely deleted; someone else's
                        can only be hidden from your own feed. */}
                    {post.userId && post.userId === user?.id ? (
                      <button
                        className="tw-more"
                        aria-label={t("fb_deletePost")}
                        onClick={() => setConfirmDelete(post.id)}
                      >
                        <Trash2 size={16} />
                      </button>
                    ) : (
                      <button className="tw-more" aria-label={t("fb_hidePost")} onClick={() => hidePost(post.id)}>
                        <MoreHorizontal size={18} />
                      </button>
                    )}
                  </div>

                  {post.body ? <p className="tw-body">{post.body}</p> : null}
                  {post.imageUrl ? (
                    <img
                      className="tw-image"
                      /* The feed shows the ~20 KB thumbnail. Legacy posts have no
                         thumbnail — their image is inline, so it costs nothing extra
                         to keep showing it. */
                      src={post.imageThumbUrl ?? post.imageUrl}
                      alt="Shared attachment"
                      loading="lazy"
                      decoding="async"
                      onClick={() => post.imageUrl && setViewerUrl(post.imageUrl)}
                    />
                  ) : null}

                  {/* Counts live on the actions themselves rather than in a
                      separate bar, so a quiet post stays visually quiet. */}
                  <div className="tw-actions">
                    <button
                      className={openComments === post.id ? "tw-act tw-reply active" : "tw-act tw-reply"}
                      aria-label={t("fb_comment")}
                      onClick={() => toggleCommentSection(post.id)}
                    >
                      <MessageCircle size={17} />
                      {post.commentCount ? <span>{post.commentCount}</span> : null}
                    </button>
                    <button
                      className={post.repostedByMe ? "tw-act tw-repost active" : "tw-act tw-repost"}
                      aria-label={t("tw_repost")}
                      onClick={() => toggleRepost(post.id)}
                    >
                      <Repeat2 size={18} />
                      {post.reposts ? <span>{post.reposts}</span> : null}
                    </button>
                    <button
                      className={post.likedByMe ? "tw-act tw-like active" : "tw-act tw-like"}
                      aria-label={t("fb_like")}
                      onClick={() => toggleLike(post.id)}
                    >
                      <Heart size={17} fill={post.likedByMe ? "currentColor" : "none"} />
                      {post.likes ? <span>{post.likes}</span> : null}
                    </button>
                    <button className="tw-act tw-share" aria-label={t("fb_share")} onClick={() => sharePost(post.body)}>
                      <Share2 size={16} />
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
                      <button type="submit" aria-label={t("a11y_sendComment")} disabled={!commentDraft.trim()}>
                        <Send size={17} />
                      </button>
                    </form>
                  </div>
                ) : null}
                </div>
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
          <button className="fb-reel-create" onClick={() => setReelOpen(true)}>
            <span className="fb-reel-create-icon"><Plus size={18} /></span>
            <span>
              <strong>{t("fb_createReel")}</strong>
              <em>{t("fb_createReelSub")}</em>
            </span>
          </button>

          {reels.length ? (
            <div className="fb-reels">
              {reels.map((reel) => (
                <article className="fb-reel" key={reel.id}>
                  <video
                    src={reel.videoUrl}
                    playsInline
                    muted
                    loop
                    preload="metadata"
                    onClick={(e) => {
                      const v = e.currentTarget;
                      if (v.paused) void v.play(); else v.pause();
                    }}
                  />
                  <span className="fb-reel-play"><Play size={20} fill="currentColor" /></span>
                  {isTrending(reel, posts) ? (
                    <span className="fb-reel-trending">{t("fb_trending")}</span>
                  ) : null}
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

          <Modal
            open={reelOpen}
            onClose={() => setReelOpen(false)}
            title={t("fb_createReel")}
            description={t("fb_createReelSub")}
          >
            <div className="fb-reel-composer">
              {reelVideo ? (
                <div className="fb-reel-preview">
                  <video src={reelVideo.preview} controls playsInline preload="metadata" />
                  <button
                    type="button"
                    aria-label={t("a11y_removePhoto")}
                    onClick={() => { URL.revokeObjectURL(reelVideo.preview); setReelVideo(undefined); }}
                  >
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <button type="button" className="fb-reel-pick" onClick={() => void pickReelVideo()}>
                  <Clapperboard size={26} />
                  <span>{t("fb_reelPickVideo")}</span>
                  <em>{t("fb_reelLimits")}</em>
                </button>
              )}
              {reelError ? <p className="fb-reel-error">{reelError}</p> : null}

              <input
                className="fb-reel-caption"
                placeholder={t("fb_reelCaption")}
                value={reelCaption}
                onChange={(e) => setReelCaption(e.target.value)}
              />

              <Button disabled={!reelVideo} onClick={shareReel}>
                {t("fb_shareReel")}
              </Button>
            </div>
          </Modal>
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
              <p className="fb-comment-empty">{t("fb_noSuggestions")}</p>
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
                      <p>{worker.isOnline ? t("fb_onlineNow") : t("fb_offline")}</p>
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
                  <span className="fb-group-icon"><ChallengeIcon icon={group.icon} size={22} /></span>
                </div>
                <div className="fb-group-info">
                  <strong>{group.name}</strong>
                  <p>{group.description}</p>
                  <small>
                    {/* The count is inside the translated string, not glued in
                        front of it: word order differs by language, and Thai,
                        Japanese and Korean put the number mid-phrase. */}
                    {groupsFromCloud
                      ? plural("fb_members", group.members)
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
            <p className="fb-comment-empty">{t("fb_noOneToTag")}</p>
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

      {/* Full-size photo. The feed only ever loaded the thumbnail; this is the
          one place the large file is fetched, and only because someone asked. */}
      {viewerUrl ? (
        <div
          className="photo-viewer"
          role="dialog"
          aria-modal="true"
          onClick={() => setViewerUrl(null)}
        >
          <button type="button" className="photo-viewer-close" aria-label={t("a11y_close")}>
            <X size={22} />
          </button>
          <img src={viewerUrl} alt="" />
        </div>
      ) : null}

      {/* Compose. Bottom-right, clear of the tab bar, and only on the timeline
          — there is nothing to compose on Reels, Friends or Groups. It does not
          open a second composer: it brings the driver to the one already at the
          top, because two composers means two places a half-written post can be
          lost. */}
      {/* Rendered into <body>, not here.
          position:fixed anchors to the viewport only if no ancestor has a
          transform — and .page-shell carries one, an identity matrix left by an
          entry animation. It changes nothing visually and still makes itself
          the containing block, so the button positioned against a 1376px-tall
          element and landed at y1140 on an 812px screen: present in the DOM,
          off the bottom of the phone. A portal steps outside the subtree. */}
      {tab === "home" && typeof document !== "undefined"
        ? createPortal(
            <button type="button" className="fb-fab" onClick={jumpToComposer} aria-label={t("fb_compose")}>
              <Plus size={24} />
            </button>,
            document.body,
          )
        : null}
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

/**
 * One person in a search result. The row itself opens their profile whatever
 * your relationship is — that is the point of search — while the button on the
 * right offers the only action that makes sense for the current state.
 */
function PersonRow({
  worker,
  state,
  t,
  onOpen,
  onAdd,
  onMessage,
}: {
  worker: Worker;
  state: ConnectionState;
  t: ReturnType<typeof useT>;
  onOpen: () => void;
  onAdd: () => void;
  onMessage: () => void;
}) {
  const app = getWorkApp(worker.app);
  return (
    <div className="fb-friend-row">
      <button className="fb-friend-tap" onClick={onOpen}>
        <span className="fb-avatar lg">{initials(worker.name)}</span>
        <div>
          <strong>{worker.name}</strong>
          <p>
            {app?.logo} {app?.name ?? "Driver"} · {worker.isOnline ? t("fb_onlineNow") : t("fb_offline")}
          </p>
        </div>
      </button>
      {state === "connected" ? (
        <Button size="sm" variant="outline" onClick={onMessage}>
          <MessageCircle size={15} /> {t("fb_message")}
        </Button>
      ) : state === "pending_out" ? (
        <Button size="sm" variant="outline" disabled>
          {t("fb_requested")}
        </Button>
      ) : state === "pending_in" ? (
        // They have already asked to connect. Offering "Add" back would be
        // confusing, and confirming belongs on the Friends tab where the
        // request lives.
        <Button size="sm" variant="outline" onClick={onMessage}>
          <MessageCircle size={15} /> {t("fb_message")}
        </Button>
      ) : (
        <Button size="sm" className="fb-add" onClick={onAdd}>
          <UserPlus size={15} /> {t("fb_add")}
        </Button>
      )}
    </div>
  );
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
  // Above the early return: hooks must run on every render.
  const t = useT();
  if (!worker) return null;
  const app = getWorkApp(worker.app);
  return (
    <Modal open={!!worker} onClose={onClose} title={t("nav_profile")}>
      <div className="worker-profile">
        <div className="worker-profile-head">
          <span className="avatar huge">{initials(worker.name)}<span className={worker.isOnline ? "" : "offline"} /></span>
          <h3>{worker.name}</h3>
          <p>{app?.logo} {app?.name} • {worker.isOnline ? t("fb_onlineNow") : t("fb_offline")}</p>
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
  const data = { title: APP_NAME, text: body };
  if (navigator.share) {
    void navigator.share(data).catch(() => undefined);
  } else if (navigator.clipboard) {
    void navigator.clipboard.writeText(body).catch(() => undefined);
  }
}

// Cross-post a Buzz update to Facebook. Meta shut down direct app-to-group
// posting in 2020, so the honest path is to hand the text to Facebook's own share
// flow: on a phone the native share sheet opens Facebook (timeline OR a group the
// user chooses); on desktop we open Facebook's web share dialog. Either way the
// driver confirms the post inside Facebook. We also copy the text so it can be
// pasted into a group composer that doesn't prefill.
function shareToFacebook(text: string) {
  if (navigator.clipboard) void navigator.clipboard.writeText(text).catch(() => undefined);
  if (navigator.share) {
    void navigator.share({ title: APP_NAME, text }).catch(() => undefined);
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
