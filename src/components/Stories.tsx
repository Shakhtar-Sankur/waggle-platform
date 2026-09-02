import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Trash2, X } from "lucide-react";
import { useT } from "../i18n";
import { MediaService } from "../services/MediaService";
import { SupabaseService } from "../services/SupabaseService";
import { useAuthStore } from "../stores/useAuthStore";
import type { StoryGroup } from "../types";

/** How long one picture holds the screen before advancing. */
const STORY_MS = 5000;

interface StoriesProps {
  groups: StoryGroup[];
  onChanged: () => void;
}

/**
 * The ring of faces above the feed, and the full-screen viewer behind it.
 *
 * Kept in one file because the two halves share a definition of "seen" that
 * has to stay in step: the ring is drawn from it, the viewer writes it, and a
 * ring that disagrees with what the viewer just showed is the bug this feature
 * invites.
 */
export function Stories({ groups, onChanged }: StoriesProps) {
  const t = useT();
  const user = useAuthStore((s) => s.user);
  const [openAt, setOpenAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const mine = groups.find((g) => g.userId === user?.id);
  const others = groups.filter((g) => g.userId !== user?.id);

  const addStory = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const photo = await MediaService.pickImage();
      if (!photo || !user) return;
      await SupabaseService.createStory(user.id, photo);
      MediaService.releasePreview(photo.preview);
      onChanged();
    } catch {
      /* A failed pick or upload leaves the row exactly as it was. There is no
         half-posted story to clean up, so there is nothing to tell the driver
         beyond the ring not appearing. */
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="st-row" role="list" aria-label={t("st_title")}>
        <button className="st-item st-mine" onClick={mine ? () => setOpenAt(groups.indexOf(mine)) : addStory} disabled={busy}>
          <span className={`st-ring ${mine ? (mine.allSeen ? "seen" : "live") : "empty"}`}>
            <span className="st-face">{user ? initialsOf(user.fullName) : "?"}</span>
            {!mine ? <span className="st-add"><Plus size={13} strokeWidth={3} /></span> : null}
          </span>
          <small>{mine ? t("st_yours") : t("st_add")}</small>
        </button>

        {others.map((g) => (
          <button key={g.userId} className="st-item" onClick={() => setOpenAt(groups.indexOf(g))} role="listitem">
            <span className={`st-ring ${g.allSeen ? "seen" : "live"}`}>
              <span className="st-face">{g.initials}</span>
            </span>
            <small>{g.author.split(" ")[0]}</small>
          </button>
        ))}
      </div>

      {/* Portalled to <body>. position:fixed is only fixed to the VIEWPORT
          while no ancestor has a transform, filter or backdrop-filter — any of
          those makes that ancestor the containing block, and the viewer's
          z-index then competes inside it instead of against the page. The
          tab bar at z-index 29 and the compose button at 45 were drawing over
          a viewer at 120, which is the giveaway. Escaping to <body> is the fix;
          raising the number would not have been. */}
      {openAt !== null && groups[openAt] && typeof document !== "undefined"
        ? createPortal(
            <StoryViewer
              groups={groups}
              startAt={openAt}
              onClose={() => { setOpenAt(null); onChanged(); }}
            />,
            document.body,
          )
        : null}
    </>
  );
}

function initialsOf(name?: string) {
  if (!name) return "?";
  return name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

/**
 * Full-screen viewer. Advances on a timer, on a tap, and rolls from the last
 * story of one author into the first of the next.
 */
function StoryViewer({ groups, startAt, onClose }: { groups: StoryGroup[]; startAt: number; onClose: () => void }) {
  const t = useT();
  const user = useAuthStore((s) => s.user);
  const [gi, setGi] = useState(startAt);
  const [si, setSi] = useState(0);
  const [paused, setPaused] = useState(false);
  const started = useRef<number>(Date.now());
  const [elapsed, setElapsed] = useState(0);

  const group = groups[gi];
  const story = group?.stories[si];

  const next = useCallback(() => {
    if (!group) return onClose();
    if (si + 1 < group.stories.length) { setSi(si + 1); return; }
    if (gi + 1 < groups.length) { setGi(gi + 1); setSi(0); return; }
    onClose();
  }, [gi, si, group, groups.length, onClose]);

  const prev = () => {
    if (si > 0) { setSi(si - 1); return; }
    if (gi > 0) { const p = gi - 1; setGi(p); setSi(Math.max(0, groups[p].stories.length - 1)); return; }
  };

  // Mark seen as soon as it is on screen, not on close: a driver who kills the
  // app mid-story has still seen it, and showing it again as unseen is a lie.
  useEffect(() => {
    if (!story || !user) return;
    void SupabaseService.markStorySeen(story.id, user.id).catch(() => undefined);
  }, [story?.id, user?.id]);

  // Progress. Restarts whenever the story changes, and stops while held.
  useEffect(() => {
    started.current = Date.now();
    setElapsed(0);
    if (paused) return;
    const tick = window.setInterval(() => {
      const e = Date.now() - started.current;
      setElapsed(e);
      if (e >= STORY_MS) next();
    }, 60);
    return () => window.clearInterval(tick);
  }, [gi, si, paused, next]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!group || !story) return null;
  const isMine = story.userId === user?.id;

  return (
    <div className="st-viewer" role="dialog" aria-modal="true" aria-label={t("st_title")}>
      <div className="st-bars">
        {group.stories.map((s, i) => (
          <span key={s.id} className="st-bar">
            <i style={{ width: i < si ? "100%" : i > si ? "0%" : `${Math.min(100, (elapsed / STORY_MS) * 100)}%` }} />
          </span>
        ))}
      </div>

      <header className="st-head">
        <span className="st-face sm">{group.initials}</span>
        <b>{group.author}</b>
        <em>{agoLabel(story.createdAt, t)}</em>
        {isMine ? (
          <button
            className="st-del"
            aria-label={t("st_delete")}
            onClick={async () => { await SupabaseService.deleteStory(story.id).catch(() => undefined); onClose(); }}
          >
            <Trash2 size={18} />
          </button>
        ) : null}
        <button className="st-close" onClick={onClose} aria-label={t("st_close")}><X size={22} /></button>
      </header>

      {/* Tap left to go back, right to go on; hold anywhere to pause. The two
          zones are siblings of the picture rather than overlaying it, so a
          screen reader is not handed two unlabelled buttons on top of an
          image. */}
      <div className="st-stage"
           onPointerDown={() => setPaused(true)}
           onPointerUp={() => setPaused(false)}
           onPointerCancel={() => setPaused(false)}>
        <img src={story.imageUrl} alt={story.caption || t("st_title")} />
        <button className="st-tap left" onClick={prev} aria-label={t("st_prev")} />
        <button className="st-tap right" onClick={next} aria-label={t("st_next")} />
      </div>

      {story.caption ? <p className="st-caption" dir="auto">{story.caption}</p> : null}
    </div>
  );
}

function agoLabel(ts: number, t: ReturnType<typeof useT>) {
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 60) return t("st_minsAgo", { n: String(mins) });
  return t("st_hoursAgo", { n: String(Math.floor(mins / 60)) });
}
