import { useEffect, useMemo, useState } from "react";
import { Bookmark, Heart, ShieldOff, SquarePen } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { useT } from "../i18n";
import { SupabaseService } from "../services/SupabaseService";
import { useAuthStore } from "../stores/useAuthStore";
import { useCommunityStore } from "../stores/useCommunityStore";
import type { FeedPost } from "../types";
import { initials, timeAgo } from "../utils/format";

type Tab = "saved" | "liked" | "posts" | "blocked";

/**
 * Everything the driver has done, in one place.
 *
 * The pieces existed and were scattered: saved posts nowhere, likes only as a
 * red heart you could not list, your own posts findable by scrolling the feed
 * until you met yourself, and blocked people on the Profile screen. Four
 * different answers to "what have I done here".
 *
 * The lists are FETCHED by id rather than filtered out of the loaded feed. The
 * feed holds the newest hundred posts; something saved three weeks ago is not
 * in it, and filtering would have quietly dropped exactly the old saves this
 * screen exists to keep.
 */
export function ActivityScreen() {
  const t = useT();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);

  const bookmarks = useCommunityStore((state) => state.bookmarks);
  const loadBookmarks = useCommunityStore((state) => state.loadBookmarks);
  const toggleBookmark = useCommunityStore((state) => state.toggleBookmark);
  const blocked = useCommunityStore((state) => state.blocked);
  const unblockUser = useCommunityStore((state) => state.unblockUser);
  const workers = useCommunityStore((state) => state.workers);
  const posts = useCommunityStore((state) => state.posts);

  const [tab, setTab] = useState<Tab>("saved");
  const [saved, setSaved] = useState<FeedPost[] | null>(null);
  const [liked, setLiked] = useState<FeedPost[] | null>(null);
  /* Which bookmark set `saved` was built from.
     Caching on `saved === null` alone lost a race: the ids arrive from
     loadBookmarks a moment after the screen mounts, so the first fetch ran with
     an empty list, cached the empty result, and the tab read "Nothing saved
     yet" while its own count said 1. Keying on the ids makes it refetch when
     they change — including from nothing to something. */
  const [savedFor, setSavedFor] = useState<string | null>(null);

  useEffect(() => {
    if (user) void loadBookmarks();
  }, [user, loadBookmarks]);

  /* Load a tab's posts the first time it is opened, not all of them up front.
     Three round trips on arrival, for two lists the driver may never look at,
     is a poor trade on a prepaid plan. */
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const key = bookmarks.join(",");
    if (tab === "saved" && savedFor !== key) {
      SupabaseService.loadPostsByIds(bookmarks, user.id)
        .then((rows) => { if (!cancelled) { setSaved(rows); setSavedFor(key); } })
        .catch(() => { if (!cancelled) { setSaved([]); setSavedFor(key); } });
    }
    if (tab === "liked" && liked === null) {
      SupabaseService.loadLikedIds(user.id)
        .then((ids) => SupabaseService.loadPostsByIds(ids, user.id))
        .then((rows) => { if (!cancelled) setLiked(rows); })
        .catch(() => { if (!cancelled) setLiked([]); });
    }
    return () => { cancelled = true; };
  }, [tab, user, bookmarks, savedFor, liked]);

  /* A blocked person's post stays out of these lists too, even though you
     liked or saved it before blocking them. The block says "you will stop
     seeing their posts"; a post of theirs sitting in your saved list is still
     their post, and an exception here would be the one place the promise did
     not hold. */
  const withoutBlocked = (rows: FeedPost[] | null) =>
    rows === null ? null : rows.filter((r) => !(r.userId && blocked.includes(r.userId)));

  // Your own posts are already in the loaded feed — no fetch needed.
  const mine = useMemo(
    () => posts.filter((post) => post.userId && post.userId === user?.id),
    [posts, user?.id],
  );

  const savedVisible = withoutBlocked(saved);
  const likedVisible = withoutBlocked(liked);

  const TABS: [Tab, string, number | null][] = [
    ["saved", t("act_tabSaved"), withoutBlocked(saved)?.length ?? bookmarks.length],
    ["liked", t("act_tabLiked"), withoutBlocked(liked)?.length ?? null],
    ["posts", t("act_tabPosts"), mine.length],
    ["blocked", t("act_tabBlocked"), blocked.length],
  ];

  const PostRow = ({ post, savedTab }: { post: FeedPost; savedTab?: boolean }) => (
    <article className="activity-row" key={post.id}>
      <span className="avatar small">{post.initials || initials(post.author)}</span>
      <div className="activity-body">
        <div className="activity-meta">
          <strong>{post.author}</strong>
          <span>{timeAgo(post.createdAt)}</span>
        </div>
        {post.body ? <p>{post.body}</p> : null}
        {post.imageUrl ? <img src={post.imageUrl} alt="" loading="lazy" /> : null}
      </div>
      {savedTab ? (
        <button
          type="button"
          className="activity-unsave"
          aria-label={t("fb_save")}
          onClick={() => {
            void toggleBookmark(post.id).catch(() => {});
            setSaved((rows) => (rows ?? []).filter((r) => r.id !== post.id));
            setSavedFor((key) => (key ?? "").split(",").filter((id) => id !== post.id).join(","));
          }}
        >
          <Bookmark size={16} fill="currentColor" />
        </button>
      ) : null}
    </article>
  );

  return (
    /* No brand band. The five coloured bands belong to the five tab-bar
       destinations — they exist so you can tell at a glance which one you
       landed on. Activity is a sub-screen reached from Profile, and giving it
       Profile's magenta put a full-height slab of colour above a short list,
       which read as a big empty page rather than as a place. Notifications, the
       app's other sub-screen, has never had one either. */
    <main className="page-shell activity-page">
      <div className="activity-head">
        <h1>{t("act_title")}</h1>
        <p>{t("act_sub")}</p>
      </div>

      <div className="mini-tabs activity-tabs" role="tablist">
        {TABS.map(([id, label, count]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {label}
            {count ? <span className="activity-count">{count}</span> : null}
          </button>
        ))}
      </div>

      <section className="dashboard-card glass-card activity-list">
        {tab === "saved" ? (
          savedVisible === null ? <p className="micro-copy">{t("history_loading")}</p>
          : savedVisible.length ? savedVisible.map((post) => <PostRow key={post.id} post={post} savedTab />)
          : <Empty icon={<Bookmark size={26} />} text={t("act_emptySaved")} />
        ) : null}

        {tab === "liked" ? (
          likedVisible === null ? <p className="micro-copy">{t("history_loading")}</p>
          : likedVisible.length ? likedVisible.map((post) => <PostRow key={post.id} post={post} />)
          : <Empty icon={<Heart size={26} />} text={t("act_emptyLiked")} />
        ) : null}

        {tab === "posts" ? (
          mine.length ? mine.map((post) => <PostRow key={post.id} post={post} />)
          : <Empty icon={<SquarePen size={26} />} text={t("act_emptyPosts")} />
        ) : null}

        {tab === "blocked" ? (
          blocked.length ? (
            blocked.map((id) => {
              // A blocked stranger may not be in the loaded list; they still
              // have to be un-blockable, so fall back to the label.
              const person = workers.find((w) => w.id === id);
              return (
                <div className="blocked-row" key={id}>
                  <span className="avatar small">{person ? initials(person.name) : "?"}</span>
                  <strong>{person?.name ?? t("mod_blocked")}</strong>
                  <Button variant="outline" onClick={() => void unblockUser(id).catch(() => {})}>
                    {t("mod_unblock")}
                  </Button>
                </div>
              );
            })
          ) : <Empty icon={<ShieldOff size={26} />} text={t("mod_blockedNone")} />
        ) : null}
      </section>

      {tab !== "blocked" ? (
        <Button variant="outline" className="wide-action" onClick={() => navigate("/community")}>
          {t("act_open")}
        </Button>
      ) : null}
    </main>
  );
}

function Empty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="activity-empty">
      <span>{icon}</span>
      <p>{text}</p>
    </div>
  );
}
