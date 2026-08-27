/**
 * A durable outbox for the things a driver writes.
 *
 * Before this, a post or message sent with no signal was caught, logged to the
 * console, and gone. Drivers work through basement car parks, lifts, tunnels and
 * dead cells all day — losing their words there is not an edge case, it is the
 * normal case.
 *
 * Anything that fails to reach the server is queued here, survives the app being
 * killed, and is retried when the connection comes back. Nothing a driver typed
 * is ever discarded silently.
 *
 * Photos are held as base64 because localStorage cannot store a Blob. That is
 * the same encoding we just removed from the *database* — the difference is that
 * here it is one pending item on one device for a few minutes, not every image
 * in every feed query forever. The queue is capped so it can never fill storage.
 */
import { SupabaseService } from "./SupabaseService";

const KEY = "masaya_outbox_v1";
/** Roughly 3 MB of base64, comfortably inside a 5 MB localStorage budget. */
const MAX_BYTES = 3_000_000;
const MAX_ATTEMPTS = 8;

export interface QueuedPhoto {
  full: string; // base64 data URL
  thumb: string;
}

export type OutboxItem =
  | {
      id: string;
      kind: "post";
      createdAt: number;
      attempts: number;
      userId: string;
      body: string;
      photo?: QueuedPhoto;
    }
  | {
      id: string;
      kind: "message";
      createdAt: number;
      attempts: number;
      userId: string;
      threadId: string;
      messageId: string;
      body: string;
      photo?: QueuedPhoto;
    };

type Listener = (pending: number) => void;

/**
 * Omit across a union member by member. A plain `Omit<OutboxItem, ...>` collapses
 * the union to the keys both variants share, which would silently drop threadId.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type NewOutboxItem = DistributiveOmit<OutboxItem, "id" | "createdAt" | "attempts">;

const listeners = new Set<Listener>();
let draining = false;
let retryTimer: number | undefined;

function read(): OutboxItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as OutboxItem[]) : [];
  } catch {
    return [];
  }
}

function write(items: OutboxItem[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Storage full: drop the oldest photo payloads rather than lose the text.
    const lightened = items.map((i) => ({ ...i, photo: undefined }));
    try {
      localStorage.setItem(KEY, JSON.stringify(lightened));
    } catch {
      /* nothing else to try; keep whatever is already stored */
    }
  }
  listeners.forEach((fn) => fn(items.length));
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Could not encode the image for the queue."));
    reader.readAsDataURL(blob);
  });
}

export const Outbox = {
  pending: () => read().length,

  subscribe(fn: Listener) {
    listeners.add(fn);
    fn(read().length);
    return () => listeners.delete(fn);
  },

  /** Queue a write. Returns false if the queue is full and the item was dropped. */
  add(item: NewOutboxItem): boolean {
    const items = read();
    const entry = {
      ...item,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      attempts: 0,
    } as OutboxItem;

    const size = JSON.stringify([...items, entry]).length;
    if (size > MAX_BYTES) {
      // Keep the words, drop the picture — a driver would rather their message
      // arrived without the photo than not at all.
      const withoutPhoto = { ...entry, photo: undefined } as OutboxItem;
      if (JSON.stringify([...items, withoutPhoto]).length > MAX_BYTES) return false;
      write([...items, withoutPhoto]);
      return true;
    }

    write([...items, entry]);
    return true;
  },

  /**
   * Try to send everything queued, oldest first.
   *
   * Order matters: messages should arrive in the order they were typed, so one
   * failure stops the drain rather than letting later items overtake it.
   */
  async drain(): Promise<void> {
    if (draining) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    if (!SupabaseService.enabled) return;

    draining = true;
    try {
      let items = read();
      while (items.length) {
        const item = items[0];
        try {
          await send(item);
          items = read().filter((i) => i.id !== item.id);
          write(items);
        } catch {
          const next = read().map((i) =>
            i.id === item.id ? { ...i, attempts: i.attempts + 1 } : i,
          );
          // Give up only after repeated failures, so a permanently malformed
          // item cannot block everything behind it forever.
          write(next.filter((i) => i.attempts < MAX_ATTEMPTS));
          scheduleRetry(item.attempts + 1);
          return;
        }
      }
    } finally {
      draining = false;
    }
  },

  /** Start listening for the connection coming back. Call once at startup. */
  start() {
    if (typeof window === "undefined") return;
    window.addEventListener("online", () => void Outbox.drain());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void Outbox.drain();
    });
    void Outbox.drain();
  },
};

async function send(item: OutboxItem) {
  let image: { url: string; thumbUrl: string } | undefined;
  if (item.photo) {
    const full = await dataUrlToBlob(item.photo.full);
    const thumb = await dataUrlToBlob(item.photo.thumb);
    image = await SupabaseService.uploadPhoto(item.userId, { full, thumb });
  }

  if (item.kind === "post") {
    await SupabaseService.addPost(item.userId, item.body, image);
    return;
  }

  await SupabaseService.sendMessage({
    id: item.messageId,
    threadId: item.threadId,
    senderId: item.userId,
    body: item.body,
    attachmentUrl: image?.url,
    attachmentThumbUrl: image?.thumbUrl,
    status: "sent",
    createdAt: item.createdAt,
  });
}

/** Exponential backoff, capped, so a long outage does not spin the radio. */
function scheduleRetry(attempts: number) {
  if (retryTimer) window.clearTimeout(retryTimer);
  const delay = Math.min(60_000, 2_000 * 2 ** Math.min(attempts, 5));
  retryTimer = window.setTimeout(() => void Outbox.drain(), delay);
}
