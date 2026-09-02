import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { MANILA_CENTER } from "../config/constants";
import type {
  AppNotification,
  Challenge,
  ChatMessage,
  ChatThread,
  Connection,
  FeedPost,
  Group,
  Job,
  LocationPoint,
  PostComment,
  ProfileSettings,
  UserSession,
  Worker,
} from "../types";
import { initials } from "../utils/format";
import type { PickedPhoto, PickedVideo } from "./MediaService";

/** Object-storage bucket holding community and chat photos. */
export const PHOTO_BUCKET = "post-photos";
/** Voice notes live apart from pictures, so their access rules do too. */
export const VOICE_BUCKET = "chat-voice";

/** Everything after this in a Supabase public object URL is `bucket/path`. */
const PUBLIC_OBJECT_MARKER = "/storage/v1/object/public/";

/**
 * Resolve stored media against the storage host we are talking to TODAY.
 *
 * Uploads store what `getPublicUrl()` returns, which is an absolute URL with
 * the storage host baked into it — so the database is full of rows like
 *
 *   http://127.0.0.1:54321/storage/v1/object/public/post-photos/x.mp4
 *
 * and every one of them is a promise that that host will answer forever. It
 * will not. Moving the project, putting a CDN in front of storage, or taking a
 * custom domain silently 404s the media on every historical post, and the row
 * still looks perfectly fine in the database. This is not hypothetical: the
 * local stack's port moved and all four reels died instantly.
 *
 * So nothing trusts the stored host. If the value carries one, the
 * bucket-and-path after the marker is lifted out and re-signed against the
 * current client; if it is already a bare path, it is used as-is. Old rows and
 * new rows both come out pointing at wherever storage actually is now, with no
 * migration and nothing to remember.
 *
 * Left alone deliberately: anything that is not a Supabase object URL. Avatars
 * can be gravatar or a social login's CDN, and rewriting those would break
 * them.
 */
export function resolveMediaUrl(stored?: string | null): string | undefined {
  if (!stored) return undefined;
  if (!supabase) return stored;

  const marker = stored.indexOf(PUBLIC_OBJECT_MARKER);
  let bucketAndPath: string;

  if (marker !== -1) {
    bucketAndPath = stored.slice(marker + PUBLIC_OBJECT_MARKER.length);
  } else if (/^https?:\/\//i.test(stored)) {
    return stored;                      // someone else's URL; not ours to rewrite
  } else {
    bucketAndPath = stored.replace(/^\/+/, "");
  }

  const slash = bucketAndPath.indexOf("/");
  if (slash <= 0) return stored;        // no bucket segment — leave it be

  const bucket = bucketAndPath.slice(0, slash);
  const path = bucketAndPath.slice(slash + 1);
  if (!path) return stored;

  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

export interface UploadedPhoto {
  url: string;
  thumbUrl: string;
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    })
  : null;

/** The host the app is actually talking to, for error messages. */
const backendHost = (() => {
  try {
    return new URL(supabaseUrl!).host;
  } catch {
    return supabaseUrl || "(not configured)";
  }
})();

/**
 * A transport failure arrives from supabase-js as a bare "Failed to fetch",
 * which says nothing about where the request was going. A release build once
 * shipped pointing at a developer's local backend, and the message gave no
 * hint — it looked identical to a bad password or a dead connection. Name the
 * host, and call out a loopback address for what it is, since on a phone that
 * means the phone itself.
 */
function describeNetworkFailure(error: unknown): Error | null {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (!/failed to fetch|fetch failed|network ?error|load failed/i.test(message)) return null;
  const isLoopback = /^(127\.|localhost|\[?::1\]?|10\.0\.2\.2)/i.test(backendHost);
  return new Error(
    isLoopback
      ? `Could not reach ${backendHost}. That address is this device, so this build is pointed at a local backend that is not running.`
      : `Could not reach ${backendHost}. Check your connection and try again.`,
  );
}

/** Runs a Supabase call, replacing an unhelpful transport error with one that
 *  names the host. Auth errors pass through untouched. */
async function withNetworkContext<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw describeNetworkFailure(error) ?? error;
  }
}

/**
 * The device's IANA time zone, e.g. "Asia/Kolkata". Sent with each location
 * update so the server resets a driver's daily counters at their own midnight
 * rather than Manila's. Returns undefined on the rare device that cannot say.
 */
function localTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}


/** Columns every worker-shaped query needs. Kept in one place so the community
 *  list and people search cannot drift apart. */
const WORKER_SELECT =
  "id, full_name, worker_locations(lat,lng,active_app,today_distance_km,today_earnings,rating,tags,updated_at)";

/**
 * "online" if a heartbeat landed recently.
 *
 * The beat is every 45 seconds, and this was 90 — exactly two beats. So a
 * driver dropped off the map after missing two: a tunnel, a dead zone, or the
 * app backgrounding for a phone call was enough to erase them. On the Friends
 * map that showed as nothing at all, which reads as "nobody is working" rather
 * than "we have not heard from them for a moment".
 *
 * 150s allows two missed beats plus latency before the dot goes out. It is not
 * generous — it is the smallest window that does not punish a normal gap.
 */
const PRESENCE_WINDOW = 1000 * 150;

/**
 * How long a driver stays ON the friends map after their dot goes out.
 *
 * Online is a dot; being on the map at all is a different question. Somebody
 * last seen four minutes ago is still useful — that is where they were, and
 * they are probably still near it — while an empty map tells you nothing and
 * looks broken. They appear dimmed with a last-seen time instead of vanishing.
 *
 * Fifteen minutes, after which the position is old enough to mislead.
 */
export const RECENT_WINDOW = 1000 * 60 * 15;

/** Shapes one profiles row, with its joined worker_locations, into a Worker. */
function toWorker(profile: any): Worker {
  const loc = Array.isArray(profile.worker_locations)
    ? profile.worker_locations[0]
    : profile.worker_locations;
  const locUpdated = loc?.updated_at ? new Date(loc.updated_at).getTime() : 0;
  const lastSeenMs = profile.last_seen ? new Date(profile.last_seen).getTime() : 0;
  // Prefer the presence heartbeat; before presence.sql is run, fall back to the
  // last location update time (old behaviour) so nothing regresses.
  const isOnline = lastSeenMs
    ? lastSeenMs > Date.now() - PRESENCE_WINDOW
    : locUpdated > Date.now() - 1000 * 60 * 8;
  // "Today's" stats only count if the last update was actually today — so a
  // driver who tracked yesterday shows 0 to others even before the cron reset.
  const trackedToday = locUpdated > 0 && isSameLocalDay(locUpdated, Date.now());
  return {
    id: profile.id,
    name: profile.full_name ?? "Driver",
    app: loc?.active_app ?? "others",
    distanceKm: trackedToday ? Number(loc?.today_distance_km ?? 0) : 0,
    earnings: trackedToday ? Number(loc?.today_earnings ?? 0) : 0,
    isOnline,
    lastSeen: lastSeenMs || locUpdated || undefined,
    location: {
      lat: Number(loc?.lat ?? MANILA_CENTER.lat),
      lng: Number(loc?.lng ?? MANILA_CENTER.lng),
      timestamp: locUpdated || Date.now(),
    },
    rating: Number(loc?.rating ?? 4.8),
    tags: loc?.tags ?? [],
  };
}

export const SupabaseService = {
  enabled: isSupabaseConfigured,

  async getSessionUser(): Promise<UserSession | null> {
    if (!supabase) return null;
    const { data } = await supabase.auth.getUser();
    return data.user ? toUserSession(data.user) : null;
  },

  async signIn(phone: string, password: string): Promise<UserSession> {
    assertSupabase();
    const { data, error } = await withNetworkContext(() =>
      supabase!.auth.signInWithPassword({
        email: phoneToEmail(phone),
        password,
      }),
    );
    if (error) throw describeNetworkFailure(error) ?? error;
    if (!data.user) throw new Error("No user returned from Supabase.");
    await this.ensureProfile(data.user, phone);
    return toUserSession(data.user, phone);
  },

  async signUp(phone: string, password: string, fullName: string): Promise<UserSession> {
    assertSupabase();
    const { data, error } = await withNetworkContext(() =>
      supabase!.auth.signUp({
        email: phoneToEmail(phone),
        password,
        options: {
          data: {
            full_name: fullName,
            phone,
          },
        },
      }),
    );
    if (error) throw describeNetworkFailure(error) ?? error;
    if (!data.user) throw new Error("No user returned from Supabase.");
    await this.ensureProfile(data.user, phone, fullName);
    return toUserSession(data.user, phone);
  },

  async signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
  },

  /**
   * Make sure this driver has a profile row.
   *
   * Deliberately NOT an upsert. `INSERT ... ON CONFLICT DO UPDATE` needs SELECT
   * on the columns it touches, and this touches `phone` — the one column
   * privacy_lockdown makes unreadable. Upserting therefore failed outright with
   * "permission denied for table profiles", no profile row was created, and
   * every later post and group-join died on the foreign key back to it.
   *
   * So: insert on first sight (phone included, written exactly once), and on a
   * duplicate fall back to an update that never mentions phone. The number is
   * already in the auth session, which is where the app reads it from anyway.
   */
  async ensureProfile(user: User, phone?: string, fullName?: string) {
    if (!supabase) return;
    const name = fullName ?? user.user_metadata?.full_name ?? "Driver";

    const { error } = await supabase.from("profiles").insert({
      id: user.id,
      full_name: name,
      phone: phone ?? user.user_metadata?.phone ?? "",
      updated_at: new Date().toISOString(),
    });
    if (!error) return;

    // 23505 = the row is already there, which is the normal path on sign-in.
    if (error.code !== "23505") throw error;
    await supabase
      .from("profiles")
      .update({ full_name: name, updated_at: new Date().toISOString() })
      .eq("id", user.id);
  },

  /**
   * Edit an existing profile. A plain UPDATE, for the same reason ensureProfile
   * is a plain INSERT: an upsert here touches `phone` and phone is not
   * SELECTable, so it fails with "permission denied for table profiles".
   *
   * Phone is not written. It is the login identifier — the sign-in email is
   * derived from it — so changing it here would only desynchronise the profile
   * from the account the driver actually signs in with.
   */
  async updateProfile(user: UserSession, updates: Partial<UserSession>) {
    if (!supabase) return;
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: updates.fullName ?? user.fullName,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);
    if (error) throw error;
  },

  /**
   * Set the driver's profile photo.
   *
   * Reuses the post-photo bucket and its thumbnail pair — an avatar is shown at
   * 34px in a chat row and 96px on the profile, so serving the full image
   * everywhere would cost a driver bandwidth on every screen.
   */
  async setAvatar(userId: string, photo: PickedPhoto): Promise<string> {
    assertSupabase();
    const { thumbUrl } = await this.uploadPhoto(userId, photo);
    const { error } = await supabase!
      .from("profiles")
      .update({ avatar_url: thumbUrl, updated_at: new Date().toISOString() })
      .eq("id", userId);
    if (error) throw error;
    return thumbUrl;
  },

  async loadSettings(userId: string): Promise<Partial<ProfileSettings> | null> {
    if (!supabase) return null;
    const { data, error } = await supabase
      .from("driver_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      activeApp: data.active_app,
      homeAddress: data.home_address ?? "",
      baseRate: Number(data.base_rate ?? 10),
      dailyGoal: Number(data.daily_goal ?? 500),
      vehicleType: data.vehicle_type ?? "car",
      maintenanceKm: Number(data.maintenance_km ?? 0),
      shareStats: Boolean(data.share_stats ?? true),
    };
  },

  async saveSettings(userId: string, settings: ProfileSettings) {
    if (!supabase) return;
    await supabase.from("driver_settings").upsert({
      user_id: userId,
      active_app: settings.activeApp,
      home_address: settings.homeAddress,
      base_rate: settings.baseRate,
      daily_goal: settings.dailyGoal,
      vehicle_type: settings.vehicleType,
      maintenance_km: settings.maintenanceKm,
      share_stats: settings.shareStats,
      updated_at: new Date().toISOString(),
    });
  },

  async loadJobs(userId: string): Promise<Job[]> {
    if (!supabase) return [];
    const { data, error } = await supabase
      .from("jobs")
      .select("*")
      .or(`assigned_to.is.null,assigned_to.eq.${userId}`)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return (data ?? []).map((job) => ({
      id: job.id,
      title: job.title,
      pickup: job.pickup,
      dropoff: job.dropoff,
      distanceKm: Number(job.distance_km),
      payout: Number(job.payout),
      app: job.app,
      etaMinutes: Number(job.eta_minutes),
      status: job.status,
    }));
  },

  async updateJobStatus(id: string, status: Job["status"], userId: string) {
    if (!supabase) return;
    await supabase
      .from("jobs")
      .update({
        status,
        assigned_to: status === "declined" ? null : userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
  },

  async loadPosts(userId?: string): Promise<FeedPost[]> {
    if (!supabase) return [];

    // image_thumb_url arrives with photo_storage.sql. Until that migration is
    // run the column does not exist and selecting it fails the whole query with
    // a 400 — which would black out the feed on a database that was working
    // fine a moment ago. Ask for it, and fall back to the old shape if the
    // database has not caught up yet.
    const WITH_THUMB =
      "id, user_id, body, image_url, image_thumb_url, video_url, created_at, profiles!feed_posts_user_id_fkey(full_name), post_likes(count), post_comments(count)";
    const WITHOUT_THUMB =
      "id, user_id, body, image_url, created_at, profiles!feed_posts_user_id_fkey(full_name), post_likes(count), post_comments(count)";

    // The two selects produce different generated row types; the mapping below
    // reads fields defensively, so bind loosely rather than fight the inference.
    let { data, error }: { data: any[] | null; error: unknown } = await supabase
      .from("feed_posts")
      .select(WITH_THUMB)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      ({ data, error } = await supabase
        .from("feed_posts")
        .select(WITHOUT_THUMB)
        .order("created_at", { ascending: false })
        .limit(100));
    }
    if (error) throw error;

    // Which of these posts has the current user liked?
    let likedIds = new Set<string>();
    if (userId) {
      const { data: myLikes } = await supabase
        .from("post_likes")
        .select("post_id")
        .eq("user_id", userId);
      likedIds = new Set((myLikes ?? []).map((row: any) => row.post_id));
    }

    // Reposts live in their own table, added after the feed shipped. Query them
    // separately and soft-fail rather than joining: a database that has not run
    // reposts.sql yet should show a feed with no reposts, not no feed at all.
    const repostCounts = new Map<string, number>();
    const repostedIds = new Set<string>();
    const postIds = (data ?? []).map((post: any) => post.id);
    if (postIds.length) {
      const { data: repostRows, error: repostError } = await supabase
        .from("post_reposts")
        .select("post_id, user_id")
        .in("post_id", postIds);
      if (!repostError) {
        for (const row of repostRows ?? []) {
          repostCounts.set(row.post_id, (repostCounts.get(row.post_id) ?? 0) + 1);
          if (userId && row.user_id === userId) repostedIds.add(row.post_id);
        }
      }
    }

    return (data ?? []).map((post: any) => {
      const author = post.profiles?.full_name ?? "Driver";
      const likeCount = post.post_likes?.[0]?.count ?? 0;
      const commentCount = post.post_comments?.[0]?.count ?? 0;
      return {
        id: post.id,
        userId: post.user_id,
        author,
        initials: initials(author),
        body: post.body,
        // Re-resolved rather than trusted: see resolveMediaUrl.
        imageUrl: resolveMediaUrl(post.image_url),
        videoUrl: resolveMediaUrl(post.video_url),
      imageThumbUrl: resolveMediaUrl(post.image_thumb_url),
        likes: Number(likeCount),
        likedByMe: likedIds.has(post.id),
        reposts: repostCounts.get(post.id) ?? 0,
        repostedByMe: repostedIds.has(post.id),
        commentCount: Number(commentCount),
        createdAt: new Date(post.created_at).getTime(),
      };
    });
  },

  /**
   * Put a picked photo in object storage and hand back its two URLs.
   *
   * The path is `{userId}/{uuid}.jpg`, because the storage policy keys ownership
   * off the first path segment — a driver can only write inside their own
   * folder. `upsert: false` so a repeated name can never overwrite.
   */
  /**
   * Upload a reel video, unmodified.
   *
   * No thumbnail and no transcoding: the app cannot re-encode video on a phone,
   * so the file the camera produced is the file that goes up. MediaService caps
   * it at 30 MB / 60s before it ever reaches here.
   */
  async uploadVideo(userId: string, video: PickedVideo): Promise<string> {
    assertSupabase();
    const bucket = supabase!.storage.from(PHOTO_BUCKET);
    const ext = video.file.type.includes("quicktime")
      ? "mov"
      : video.file.type.includes("webm")
        ? "webm"
        : "mp4";
    const path = `${userId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await bucket.upload(path, video.file, {
      contentType: video.file.type || "video/mp4",
      cacheControl: "31536000",
      upsert: false,
    });
    if (error) throw error;
    return bucket.getPublicUrl(path).data.publicUrl;
  },

  /**
   * Put a voice note in the driver's own folder and hand back its URL.
   *
   * Its own bucket, not the photo one: a storage policy written for pictures
   * should never end up deciding who may hear a private conversation. The path
   * begins with the user's id because that is what the insert policy checks.
   */
  async uploadVoice(userId: string, blob: Blob, mimeType: string): Promise<string> {
    assertSupabase();
    // The container decides the extension, and it differs by platform — Android
    // records webm, iOS records mp4. Guessing one breaks playback on the other.
    const ext = mimeType.includes("mp4") ? "m4a" : mimeType.includes("ogg") ? "ogg" : "webm";
    const path = `${userId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase!.storage.from(VOICE_BUCKET).upload(path, blob, {
      contentType: mimeType,
      cacheControl: "31536000",   // immutable: the name carries a uuid
      upsert: false,
    });
    if (error) throw error;
    return supabase!.storage.from(VOICE_BUCKET).getPublicUrl(path).data.publicUrl;
  },

  /**
   * Takes only the two blobs, not a whole PickedPhoto. The Outbox rebuilds a
   * photo from queued data URLs and has no dimensions or byte count to give —
   * demanding the full type forced it to invent them, which is how a parameter
   * ends up carrying fields the function never reads.
   */
  async uploadPhoto(
    userId: string,
    photo: Pick<PickedPhoto, "full" | "thumb">,
  ): Promise<UploadedPhoto> {
    assertSupabase();
    const id = crypto.randomUUID();
    const bucket = supabase!.storage.from(PHOTO_BUCKET);

    const put = async (blob: Blob, suffix: string) => {
      const path = `${userId}/${id}${suffix}.jpg`;
      const { error } = await bucket.upload(path, blob, {
        contentType: "image/jpeg",
        cacheControl: "31536000", // immutable: the name contains a uuid
        upsert: false,
      });
      if (error) throw error;
      return bucket.getPublicUrl(path).data.publicUrl;
    };

    // Thumbnail first: it is what the feed shows, so if the full upload fails on
    // a bad connection the post is still usable rather than blank.
    const thumbUrl = await put(photo.thumb, "_thumb");
    const url = await put(photo.full, "");
    return { url, thumbUrl };
  },

  async addPost(
    userId: string,
    body: string,
    image?: { url: string; thumbUrl: string },
    videoUrl?: string,
  ): Promise<FeedPost | null> {
    if (!supabase) return null;
    const SELECT_WITH =
      "id, user_id, body, image_url, image_thumb_url, video_url, created_at, profiles!feed_posts_user_id_fkey(full_name)";
    const SELECT_WITHOUT =
      "id, user_id, body, image_url, created_at, profiles!feed_posts_user_id_fkey(full_name)";

    let { data, error }: { data: any; error: unknown } = await supabase
      .from("feed_posts")
      .insert({
        user_id: userId,
        body,
        image_url: image?.url ?? null,
        video_url: videoUrl ?? null,
        image_thumb_url: image?.thumbUrl ?? null,
      })
      .select(SELECT_WITH)
      .single();

    // Same reason as loadPosts: before photo_storage.sql the thumb column is not
    // there, and posting should not start failing because of a pending migration.
    if (error) {
      ({ data, error } = await supabase
        .from("feed_posts")
        .insert({ user_id: userId, body, image_url: image?.url ?? null })
        .select(SELECT_WITHOUT)
        .single());
    }
    if (error) throw error;
    const author = (data as any).profiles?.full_name ?? "You";
    return {
      id: data.id,
      userId: data.user_id,
      author,
      initials: initials(author),
      body: data.body,
      imageUrl: resolveMediaUrl(data.image_url),
      imageThumbUrl: resolveMediaUrl(data.image_thumb_url),
      reposts: 0,
      repostedByMe: false,
      likes: 0,
      likedByMe: false,
      commentCount: 0,
      createdAt: new Date(data.created_at).getTime(),
    };
  },

  // Remove a post the driver wrote. RLS (feed_posts_delete_own) means the
  // user_id filter is belt-and-braces — the database enforces ownership too.
  async deletePost(postId: string, userId: string) {
    assertSupabase();
    const { error } = await supabase!
      .from("feed_posts")
      .delete()
      .eq("id", postId)
      .eq("user_id", userId);
    if (error) throw error;
  },

  // Remove a message the driver sent (chat_messages_delete_own).
  async deleteMessage(messageId: string, userId: string) {
    assertSupabase();
    const { error } = await supabase!
      .from("chat_messages")
      .delete()
      .eq("id", messageId)
      .eq("sender_id", userId);
    if (error) throw error;
  },

  async setLike(postId: string, userId: string, liked: boolean) {
    assertSupabase();
    if (liked) {
      // INSERT, not upsert. post_likes has insert and delete policies and no
      // UPDATE policy — correctly, since a like is a junction row with nothing
      // to update — so an upsert becomes ON CONFLICT DO UPDATE and is refused
      // by RLS. That happens whenever the feed's likedByMe is stale, which the
      // 2.5s poll makes ordinary, and the like would silently bounce back.
      const { error } = await supabase!
        .from("post_likes")
        .insert({ post_id: postId, user_id: userId });
      // 23505 just means it was already liked, which is the state we wanted.
      if (error && error.code !== "23505") throw error;
    } else {
      const { error } = await supabase!
        .from("post_likes")
        .delete()
        .eq("post_id", postId)
        .eq("user_id", userId);
      if (error) throw error;
    }
  },

  /**
   * Repost or un-repost, mirroring setLike exactly — including the reason it is
   * an INSERT rather than an upsert. post_reposts has insert and delete policies
   * and deliberately no UPDATE policy, so an upsert compiles to
   * ON CONFLICT DO UPDATE and RLS refuses it. That is the same mistake that
   * broke likes, profile edits and group joins in this app.
   */
  async setRepost(postId: string, userId: string, reposted: boolean) {
    assertSupabase();
    if (reposted) {
      const { error } = await supabase!
        .from("post_reposts")
        .insert({ post_id: postId, user_id: userId });
      // 23505 means it was already reposted, which is the state we wanted.
      if (error && error.code !== "23505") throw error;
    } else {
      const { error } = await supabase!
        .from("post_reposts")
        .delete()
        .eq("post_id", postId)
        .eq("user_id", userId);
      if (error) throw error;
    }
  },

  async loadComments(postId: string): Promise<PostComment[]> {
    if (!supabase) return [];
    const { data, error } = await supabase
      .from("post_comments")
      .select("id, body, created_at, profiles(full_name)")
      .eq("post_id", postId)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) throw error;
    return (data ?? []).map((row: any) => {
      const author = row.profiles?.full_name ?? "Driver";
      return {
        id: row.id,
        postId,
        author,
        initials: initials(author),
        body: row.body,
        createdAt: new Date(row.created_at).getTime(),
      };
    });
  },

  async addComment(postId: string, userId: string, body: string): Promise<PostComment> {
    assertSupabase();
    const { data, error } = await supabase!
      .from("post_comments")
      .insert({ post_id: postId, user_id: userId, body })
      .select("id, body, created_at, profiles(full_name)")
      .single();
    if (error) throw error;
    const author = (data as any).profiles?.full_name ?? "You";
    return {
      id: data.id,
      postId,
      author,
      initials: initials(author),
      body: data.body,
      createdAt: new Date(data.created_at).getTime(),
    };
  },

  async loadConnections(userId: string): Promise<Connection[]> {
    if (!supabase) return [];
    const { data, error } = await supabase
      .from("connections")
      .select("id, requester_id, addressee_id, status")
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);
    if (error) throw error;
    return (data ?? []).map((row: any) => ({
      id: row.id,
      requesterId: row.requester_id,
      addresseeId: row.addressee_id,
      status: row.status,
    }));
  },

  async sendConnection(requesterId: string, addresseeId: string): Promise<Connection> {
    assertSupabase();
    const { data, error } = await supabase!
      .from("connections")
      .insert({ requester_id: requesterId, addressee_id: addresseeId, status: "pending" })
      .select("id, requester_id, addressee_id, status")
      .single();
    if (error) throw error;
    return {
      id: data.id,
      requesterId: data.requester_id,
      addresseeId: data.addressee_id,
      status: data.status,
    };
  },

  async acceptConnection(id: string) {
    assertSupabase();
    const { error } = await supabase!
      .from("connections")
      .update({ status: "accepted" })
      .eq("id", id);
    if (error) throw error;
  },

  async startDirectThread(otherUserId: string): Promise<string> {
    assertSupabase();
    const { data, error } = await supabase!.rpc("start_direct_thread", { p_other: otherUserId });
    if (error) throw error;
    return data as string;
  },

  // Every registered user is discoverable/searchable (loaded from profiles),
  // enriched with live location/stats when they have shared them.
  async loadWorkers(currentUserId?: string): Promise<Worker[]> {
    if (!supabase) return [];

    // Presence lives in profiles.last_seen (added by supabase/presence.sql). If that
    // migration hasn't run yet, the column is missing → fall back gracefully so the
    // whole Discover/Friends/Map feature never breaks.
    let data: any[] | null = null;
    let error: any = null;
    ({ data, error } = await supabase
      .from("profiles")
      .select(`${WORKER_SELECT}, last_seen`)
      .limit(500));
    if (error) {
      ({ data, error } = await supabase.from("profiles").select(WORKER_SELECT).limit(500));
      if (error) throw error;
    }

    return (data ?? [])
      .filter((profile: any) => profile.id !== currentUserId)
      .map(toWorker);
  },

  /**
   * Find registered drivers by name, whether or not you are connected to them.
   *
   * Searching server-side rather than filtering loadWorkers' result matters:
   * that call is capped at 500 profiles, so once the app has more drivers than
   * that, a client-side filter would silently stop finding people who exist.
   */
  async searchWorkers(query: string, currentUserId?: string): Promise<Worker[]> {
    if (!supabase) return [];
    const term = query.trim();
    if (term.length < 2) return [];
    // % and _ are wildcards in LIKE, so a driver searching for "100_" would
    // otherwise match names they did not type.
    const escaped = term.replace(/[\\%_]/g, (c) => `\\${c}`);

    let data: any[] | null = null;
    let error: any = null;
    ({ data, error } = await supabase
      .from("profiles")
      .select(`${WORKER_SELECT}, last_seen`)
      .ilike("full_name", `%${escaped}%`)
      .limit(40));
    if (error) {
      // Same presence fallback as loadWorkers.
      ({ data, error } = await supabase
        .from("profiles")
        .select(WORKER_SELECT)
        .ilike("full_name", `%${escaped}%`)
        .limit(40));
      if (error) throw error;
    }

    return (data ?? [])
      .filter((profile: any) => profile.id !== currentUserId)
      .map(toWorker);
  },

  // Heartbeat: mark the current user as "seen now" so others get live presence.
  // Fire-and-forget; if presence.sql hasn't been run the column is missing and this
  // simply no-ops (the error is swallowed by the caller).
  async updateLastSeen(userId: string) {
    if (!supabase) return;
    await supabase.from("profiles").update({ last_seen: new Date().toISOString() }).eq("id", userId);
  },

  // Remove the driver from the shared community map. Their own private route
  // history in route_points is untouched — that is their data, not shared data.
  async stopSharingLocation(userId: string) {
    if (!supabase) return;
    // This is the one write whose failure is a privacy problem rather than a
    // sync problem: if the delete does not land, the driver's position stays
    // published while the app shows sharing as off. Surface it instead of
    // discarding the error like the other fire-and-forget writes.
    const { error } = await supabase.from("worker_locations").delete().eq("user_id", userId);
    if (error) {
      console.error("Could not stop sharing location — position may still be public:", error);
      throw error;
    }
  },

  async saveLocation(
    user: UserSession,
    point: LocationPoint,
    activeApp: string | null,
    distanceKm: number,
    earnings: number,
    shareStats = true,
  ) {
    if (!supabase) return;
    // "Share stats with community" used to be a placebo — stored, shown, and
    // never enforced. If the driver has it off we do NOT publish their position
    // to the community map at all, and the shared row is removed.
    if (!shareStats) {
      await this.stopSharingLocation(user.id);
    } else {
      // Deliberately does NOT write share_stats: the column only exists after
      // privacy_lockdown.sql runs, and sending it beforehand would break the
      // upsert. Sharing-off is expressed by REMOVING the row (above), so this
      // build behaves correctly whether or not that migration has run yet.
      const row = {
        user_id: user.id,
        lat: point.lat,
        lng: point.lng,
        accuracy: point.accuracy,
        active_app: activeApp,
        today_distance_km: distanceKm,
        today_earnings: earnings,
        updated_at: new Date(point.timestamp).toISOString(),
      };

      // `timezone` arrives with daily_reset.sql, so the driver's counters reset
      // at their own midnight instead of Manila's. Before that migration the
      // column does not exist and sending it 400s the whole upsert — which
      // would silently stop GPS tracking, the one feature that must not break.
      const { error } = await supabase
        .from("worker_locations")
        .upsert({ ...row, timezone: localTimeZone() });
      if (error) await supabase.from("worker_locations").upsert(row);
    }
    await supabase.from("route_points").insert({
      user_id: user.id,
      lat: point.lat,
      lng: point.lng,
      accuracy: point.accuracy,
      active_app: activeApp,
      recorded_at: new Date(point.timestamp).toISOString(),
    });
  },

  /**
   * Every point recorded on one local day, oldest first.
   *
   * The app has written to route_points since the beginning and has never once
   * read it back: the map drew the copy in the phone's own store, which
   * `ensureToday()` clears at midnight. So a driver's history existed, was
   * indexed for exactly this query, and was invisible to them.
   *
   * The day is bounded in the caller's timezone rather than UTC, because "where
   * did I go on Tuesday" means the driver's Tuesday. Row-level security already
   * restricts this table to `auth.uid() = user_id`, so no filter here is what
   * keeps another driver's history private — the database is.
   */
  async routePointsForDay(dayStart: Date): Promise<LocationPoint[]> {
    if (!supabase) return [];
    const from = new Date(dayStart);
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + 1);

    const { data, error } = await supabase
      .from("route_points")
      .select("lat, lng, accuracy, recorded_at")
      .gte("recorded_at", from.toISOString())
      .lt("recorded_at", to.toISOString())
      .order("recorded_at", { ascending: true })
      // A long shift at a few seconds per fix is thousands of rows. This is the
      // ceiling the matcher and the phone can both take; thinning happens after.
      .limit(5000);

    if (error || !Array.isArray(data)) return [];
    return data.map((r) => ({
      lat: Number(r.lat),
      lng: Number(r.lng),
      accuracy: r.accuracy == null ? undefined : Number(r.accuracy),
      timestamp: new Date(r.recorded_at).getTime(),
    })) as LocationPoint[];
  },

  /** Which local days have any recorded movement, newest first — for the picker. */
  async routeDaysAvailable(limitDays = 60): Promise<string[]> {
    if (!supabase) return [];
    const since = new Date();
    since.setDate(since.getDate() - limitDays);
    since.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from("route_points")
      .select("recorded_at")
      .gte("recorded_at", since.toISOString())
      .order("recorded_at", { ascending: false })
      .limit(20000);

    if (error || !Array.isArray(data)) return [];
    const days = new Set<string>();
    for (const r of data) {
      const d = new Date(r.recorded_at);
      // Local date key, matching how the day is bounded above.
      days.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    }
    return [...days];
  },

  async loadThreads(userId: string): Promise<ChatThread[]> {
    if (!supabase) return [];
    const { data, error } = await supabase
      .from("chat_thread_members")
      .select("thread_id, chat_threads(id,title,is_group,updated_at)")
      .eq("user_id", userId)
      .order("thread_id");
    if (error) throw error;

    const threads: ChatThread[] = (data ?? []).map((row: any) => ({
      id: row.chat_threads.id,
      title: row.chat_threads.title,
      isGroup: row.chat_threads.is_group,
      participantIds: [],
      unreadCount: 0,
      typingUserIds: [],
      updatedAt: new Date(row.chat_threads.updated_at).getTime(),
    }));

    // Resolve every member of the user's threads so DMs know who the "other" person
    // is (needed for presence / last-seen). Non-fatal if it fails.
    if (threads.length) {
      try {
        const { data: members } = await supabase
          .from("chat_thread_members")
          .select("thread_id, user_id")
          .in(
            "thread_id",
            threads.map((thread) => thread.id),
          );
        const byThread = new Map<string, string[]>();
        (members ?? []).forEach((row: any) => {
          const list = byThread.get(row.thread_id) ?? [];
          list.push(row.user_id);
          byThread.set(row.thread_id, list);
        });
        threads.forEach((thread) => {
          thread.participantIds = byThread.get(thread.id) ?? [];
        });
      } catch (error) {
        console.warn("Could not load thread members:", error);
      }
    }

    return threads;
  },

  async loadMessages(threadId: string): Promise<ChatMessage[]> {
    if (!supabase) return [];
    const { data, error } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) throw error;

    // Reactions come from their own table, in one query for the whole page of
    // messages rather than one per message — 200 messages would otherwise be
    // 200 round trips on opening a chat.
    //
    // A failure here is swallowed on purpose. A project that has not run
    // chat_reply_reactions.sql has no such table, and a chat that refuses to
    // open because nobody can put a thumbs-up on anything is a worse outcome
    // than a chat with no reactions in it.
    const ids = (data ?? []).map((m) => m.id);
    const byMessage = new Map<string, Record<string, string[]>>();
    if (ids.length) {
      const { data: reactions } = await supabase
        .from("message_reactions")
        .select("message_id, user_id, emoji")
        .in("message_id", ids);
      for (const r of reactions ?? []) {
        const group = byMessage.get(r.message_id) ?? {};
        (group[r.emoji] ??= []).push(r.user_id);
        byMessage.set(r.message_id, group);
      }
    }

    return (data ?? []).map((message) => ({
      id: message.id,
      threadId: message.thread_id,
      senderId: message.sender_id,
      body: message.body,
      replyToId: message.reply_to ?? undefined,
      reactions: byMessage.get(message.id),
      attachmentUrl: resolveMediaUrl(message.attachment_url),
      attachmentThumbUrl: resolveMediaUrl(message.attachment_thumb_url),
      voiceUrl: resolveMediaUrl(message.voice_url),
      voiceSeconds: message.voice_seconds == null ? undefined : Number(message.voice_seconds),
      // Stored as jsonb. A client older than the column gets undefined and
      // draws a flat bar rather than throwing on a missing array.
      voiceLevels: Array.isArray(message.voice_levels) ? message.voice_levels : undefined,
      createdAt: new Date(message.created_at).getTime(),
      status: message.status ?? "sent",
    }));
  },

  /**
   * Add other drivers to a thread the caller already belongs to.
   *
   * Separate from createThread because a group is named and populated in one
   * step by the person creating it, and a half-made group — a thread with one
   * member — is worse than none.
   */
  async addThreadMembers(threadId: string, userIds: string[]): Promise<void> {
    assertSupabase();
    if (!userIds.length) return;
    // Through an RPC, not a direct insert: RLS on chat_thread_members permits
    // `auth.uid() = user_id` only, so a driver can add themselves and nobody
    // else. add_group_members is SECURITY DEFINER and checks that the caller is
    // in the thread and that everyone added is an accepted connection.
    const { error } = await supabase!.rpc("add_group_members", {
      p_thread: threadId,
      p_members: userIds,
    });
    if (error) throw error;
  },

  async createThread(userId: string, title: string, isGroup: boolean): Promise<ChatThread> {
    assertSupabase();
    // One call, one transaction. This used to be two inserts — the thread, then
    // the creator's membership — and anything failing between them left a
    // thread with no members. Every policy on chat_threads and chat_messages
    // gates on membership, so such a thread is invisible to every client: it
    // cannot be listed, opened, joined or deleted through the app, ever.
    //
    // Not theoretical. A database carrying load-test traffic had 290,934 of
    // them against 12 real ones, from runs that were killed mid-way.
    //
    // create_thread is plpgsql, so the membership insert failing rolls the
    // thread insert back with it. See supabase/chat_thread_atomic.sql.
    const { data: rows, error: threadError } = await supabase!.rpc("create_thread", {
      p_title: title,
      p_is_group: isGroup,
    });

    let thread = Array.isArray(rows) ? rows[0] : rows;

    if (threadError || !thread) {
      // The function is not there. A project that has not run
      // chat_thread_atomic.sql answers PGRST202 / 404, and without this the
      // whole feature is dead on that backend — you cannot make a group at
      // all, which is worse than making one non-atomically.
      //
      // So: fall back to the two inserts this replaced. They carry the orphan
      // risk the RPC exists to remove, which is why the RPC is tried first and
      // why this path logs — but a driver on a not-yet-migrated backend gets a
      // working app rather than a broken button.
      const missing =
        (threadError as { code?: string } | null)?.code === "PGRST202" ||
        /not find the function|does not exist/i.test(threadError?.message ?? "");
      if (threadError && !missing) throw threadError;
      console.warn("create_thread RPC unavailable; falling back to two inserts.");

      const { data: legacy, error: insertError } = await supabase!
        .from("chat_threads")
        .insert({ title, is_group: isGroup, created_by: userId })
        .select("id, title, is_group, updated_at")
        .single();
      if (insertError) throw insertError;

      const { error: memberError } = await supabase!
        .from("chat_thread_members")
        .insert({ thread_id: legacy.id, user_id: userId });
      if (memberError) {
        // Do not leave the orphan behind if we can help it.
        await supabase!.from("chat_threads").delete().eq("id", legacy.id);
        throw memberError;
      }
      thread = legacy;
    }

    return {
      id: thread.id,
      title: thread.title,
      isGroup: thread.is_group,
      participantIds: [userId],
      unreadCount: 0,
      typingUserIds: [],
      updatedAt: new Date(thread.updated_at).getTime(),
    };
  },

  /**
   * Leave a group conversation.
   *
   * Deletes only the caller's own membership row — the RLS policy
   * chat_members_leave_own restricts it to auth.uid(), so this cannot remove
   * anyone else. The thread and its messages stay for whoever remains.
   */
  async leaveThread(threadId: string, userId: string): Promise<void> {
    assertSupabase();
    const { error } = await supabase!
      .from("chat_thread_members")
      .delete()
      .eq("thread_id", threadId)
      .eq("user_id", userId);
    if (error) throw error;
  },

  async sendMessage(message: ChatMessage): Promise<void> {
    assertSupabase();
    const { error: insertError } = await supabase!.from("chat_messages").insert({
      id: message.id,
      thread_id: message.threadId,
      sender_id: message.senderId,
      body: message.body,
      attachment_url: message.attachmentUrl ?? null,
      ...(message.attachmentThumbUrl
        ? { attachment_thumb_url: message.attachmentThumbUrl }
        : {}),
      // Spread rather than always sent: a project that has not run
      // chat_voice_notes.sql would reject the entire insert on an unknown
      // column, so a plain text message would fail for want of a field it
      // does not even use.
      ...(message.voiceUrl
        ? {
            voice_url: message.voiceUrl,
            voice_seconds: message.voiceSeconds ?? null,
            voice_levels: message.voiceLevels ?? null,
          }
        : {}),
      // Same guard, same reason: only sent when there is a reply, so a plain
      // message still inserts against a schema without the column.
      ...(message.replyToId ? { reply_to: message.replyToId } : {}),
      status: message.status,
      created_at: new Date(message.createdAt).toISOString(),
    });

    if (insertError) {
      // 42703 is "column does not exist". A project that has not run
      // chat_voice_notes.sql or chat_reply_reactions.sql rejects the WHOLE
      // insert over one unknown column — so a reply, or a voice note, took the
      // driver's message down with it rather than losing only the extra.
      //
      // Retry with just the fields every schema has. The reply loses its quote
      // and a voice note loses its audio, which is a real loss and is why the
      // migration should be run — but the words the driver typed still arrive,
      // which is the part they cannot retype from memory.
      const unknownColumn =
        (insertError as { code?: string }).code === "42703" ||
        /column .* does not exist/i.test(insertError.message ?? "");
      if (!unknownColumn) throw insertError;

      console.warn(
        "chat_messages is missing optional columns; sending without reply/voice.",
        insertError.message,
      );
      const { error: retryError } = await supabase!.from("chat_messages").insert({
        id: message.id,
        thread_id: message.threadId,
        sender_id: message.senderId,
        body: message.body,
        attachment_url: message.attachmentUrl ?? null,
        status: message.status,
        created_at: new Date(message.createdAt).toISOString(),
      });
      if (retryError) throw retryError;
    }

    const { error: updateError } = await supabase!
      .from("chat_threads")
      .update({ updated_at: new Date(message.createdAt).toISOString() })
      .eq("id", message.threadId);
    if (updateError) throw updateError;
  },

  /**
   * Put the caller's reaction on a message, or take it off.
   *
   * One row per person per message, so choosing a different emoji REPLACES
   * theirs instead of adding a second — an upsert on the primary key, which is
   * (message_id, user_id). Passing null removes it, which is also what the UI
   * sends when you tap the emoji you already picked.
   *
   * RLS does the enforcing: the policy checks `auth.uid() = user_id` and that
   * the caller is a member of the message's thread, so neither reacting as
   * somebody else nor reacting to a stranger's message by guessing an id is
   * possible from here.
   */
  async setReaction(messageId: string, userId: string, emoji: string | null): Promise<void> {
    assertSupabase();
    if (emoji === null) {
      const { error } = await supabase!
        .from("message_reactions")
        .delete()
        .eq("message_id", messageId)
        .eq("user_id", userId);
      if (error) throw error;
      return;
    }
    const { error } = await supabase!
      .from("message_reactions")
      .upsert(
        { message_id: messageId, user_id: userId, emoji },
        { onConflict: "message_id,user_id" },
      );
    if (error) throw error;
  },

  // Real cloud groups: true member counts + whether the current user has joined.
  async loadGroups(userId?: string): Promise<Group[]> {
    if (!supabase) return [];
    const { data, error } = await supabase
      .from("groups")
      .select("id, name, description, color, icon, group_members(count)")
      .order("created_at", { ascending: true });
    if (error) throw error;

    let mine = new Set<string>();
    if (userId) {
      const { data: memberships } = await supabase
        .from("group_members")
        .select("group_id")
        .eq("user_id", userId);
      mine = new Set((memberships ?? []).map((row: any) => row.group_id));
    }

    return (data ?? []).map((group: any) => ({
      id: group.id,
      name: group.name,
      description: group.description,
      color: group.color,
      icon: group.icon,
      members: Number(group.group_members?.[0]?.count ?? 0),
      joined: mine.has(group.id),
    }));
  },

  async joinGroup(groupId: string, userId: string) {
    assertSupabase();
    // ignoreDuplicates, so this compiles to ON CONFLICT DO NOTHING rather than
    // DO UPDATE. A plain upsert takes the UPDATE path when the row already
    // exists, and RLS on group_members has INSERT and DELETE policies but no
    // UPDATE one — so tapping Join on a group you are already in failed with
    // "new row violates row-level security policy (USING expression)".
    //
    // Rejoining should be a no-op anyway: there is nothing on the row to
    // update, the primary key is (group_id, user_id).
    const { error } = await supabase!
      .from("group_members")
      .upsert({ group_id: groupId, user_id: userId }, { ignoreDuplicates: true });
    if (error) throw error;
  },

  async leaveGroup(groupId: string, userId: string) {
    assertSupabase();
    const { error } = await supabase!
      .from("group_members")
      .delete()
      .eq("group_id", groupId)
      .eq("user_id", userId);
    if (error) throw error;
  },

  // Read receipts: a recipient marks incoming messages 'delivered' when their
  // app fetches them (RLS scopes the update to threads they belong to).
  async markDelivered(userId: string) {
    if (!supabase) return;
    await supabase
      .from("chat_messages")
      .update({ status: "delivered" })
      .eq("status", "sent")
      .neq("sender_id", userId);
  },

  // …and 'read' when they actually have the conversation open (blue ticks).
  async markRead(threadId: string, userId: string) {
    if (!supabase) return;
    await supabase
      .from("chat_messages")
      .update({ status: "read" })
      .eq("thread_id", threadId)
      .neq("sender_id", userId)
      .neq("status", "read");
  },

  async savePushToken(userId: string, token: string, platform = "android") {
    if (!supabase) return;
    const { error } = await supabase.from("device_tokens").upsert({
      user_id: userId,
      token,
      platform,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  },

  async deleteAccount(): Promise<void> {
    assertSupabase();
    const { error } = await supabase!.rpc("delete_own_account");
    if (error) throw error;
    await supabase!.auth.signOut();
  },

  async loadNotifications(userId: string): Promise<AppNotification[]> {
    if (!supabase) return [];
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return (data ?? []).map((notification) => ({
      id: notification.id,
      title: notification.title,
      description: notification.description,
      kind: notification.kind,
      read: notification.read,
      createdAt: new Date(notification.created_at).getTime(),
    }));
  },

  async saveNotification(userId: string, notification: AppNotification) {
    if (!supabase) return;
    await supabase.from("notifications").insert({
      id: notification.id,
      user_id: userId,
      title: notification.title,
      description: notification.description,
      kind: notification.kind,
      read: notification.read,
      created_at: new Date(notification.createdAt).toISOString(),
    });
  },

  // Authorize the realtime socket with the user's token so row-level-security
  // tables (notifications, connections, chat_messages) broadcast their changes.
  async refreshRealtimeAuth() {
    if (!supabase) return;
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) {
      supabase.realtime.setAuth(data.session.access_token);
    }
  },

  subscribeToTable(table: string, callback: () => void) {
    if (!supabase) return () => undefined;
    const channel = supabase
      .channel(`${table}-changes`)
      .on("postgres_changes", { event: "*", schema: "public", table }, callback)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  },

  // Fires when the user is signed out — including when a token refresh fails
  // (expired/revoked session). Lets the app clear stale local state cleanly.
  onSignedOut(callback: () => void) {
    if (!supabase) return () => undefined;
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") callback();
    });
    return () => data.subscription.unsubscribe();
  },
};

function assertSupabase() {
  if (!supabase) throw new Error("Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
}

function isSameLocalDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

function phoneToEmail(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return `${digits || "driver"}@masaya.local`;
}

function toUserSession(user: User, phone?: string): UserSession {
  return {
    id: user.id,
    fullName: user.user_metadata?.full_name ?? user.email?.split("@")[0] ?? "Driver",
    phone: phone ?? user.user_metadata?.phone ?? "",
  };
}
