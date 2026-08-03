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

export const SupabaseService = {
  enabled: isSupabaseConfigured,

  async getSessionUser(): Promise<UserSession | null> {
    if (!supabase) return null;
    const { data } = await supabase.auth.getUser();
    return data.user ? toUserSession(data.user) : null;
  },

  async signIn(phone: string, password: string): Promise<UserSession> {
    assertSupabase();
    const { data, error } = await supabase!.auth.signInWithPassword({
      email: phoneToEmail(phone),
      password,
    });
    if (error) throw error;
    if (!data.user) throw new Error("No user returned from Supabase.");
    await this.ensureProfile(data.user, phone);
    return toUserSession(data.user, phone);
  },

  async signUp(phone: string, password: string, fullName: string): Promise<UserSession> {
    assertSupabase();
    const { data, error } = await supabase!.auth.signUp({
      email: phoneToEmail(phone),
      password,
      options: {
        data: {
          full_name: fullName,
          phone,
        },
      },
    });
    if (error) throw error;
    if (!data.user) throw new Error("No user returned from Supabase.");
    await this.ensureProfile(data.user, phone, fullName);
    return toUserSession(data.user, phone);
  },

  async signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
  },

  async ensureProfile(user: User, phone?: string, fullName?: string) {
    if (!supabase) return;
    await supabase.from("profiles").upsert({
      id: user.id,
      full_name: fullName ?? user.user_metadata?.full_name ?? "Driver",
      phone: phone ?? user.user_metadata?.phone ?? "",
      updated_at: new Date().toISOString(),
    });
  },

  async updateProfile(user: UserSession, updates: Partial<UserSession>) {
    if (!supabase) return;
    await supabase.from("profiles").upsert({
      id: user.id,
      full_name: updates.fullName ?? user.fullName,
      phone: updates.phone ?? user.phone,
      updated_at: new Date().toISOString(),
    });
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
    const { data, error } = await supabase
      .from("feed_posts")
      .select(
        "id, user_id, body, image_url, created_at, profiles!feed_posts_user_id_fkey(full_name), post_likes(count), post_comments(count)",
      )
      .order("created_at", { ascending: false })
      .limit(100);
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
        imageUrl: post.image_url ?? undefined,
        likes: Number(likeCount),
        likedByMe: likedIds.has(post.id),
        commentCount: Number(commentCount),
        createdAt: new Date(post.created_at).getTime(),
      };
    });
  },

  async addPost(userId: string, body: string, imageUrl?: string): Promise<FeedPost | null> {
    if (!supabase) return null;
    const { data, error } = await supabase
      .from("feed_posts")
      .insert({ user_id: userId, body, image_url: imageUrl ?? null })
      .select("id, user_id, body, image_url, created_at, profiles!feed_posts_user_id_fkey(full_name)")
      .single();
    if (error) throw error;
    const author = (data as any).profiles?.full_name ?? "You";
    return {
      id: data.id,
      userId: data.user_id,
      author,
      initials: initials(author),
      body: data.body,
      imageUrl: data.image_url ?? undefined,
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
      const { error } = await supabase!
        .from("post_likes")
        .upsert({ post_id: postId, user_id: userId });
      if (error) throw error;
    } else {
      const { error } = await supabase!
        .from("post_likes")
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
    const locationSelect =
      "id, full_name, worker_locations(lat,lng,active_app,today_distance_km,today_earnings,rating,tags,updated_at)";

    // Presence lives in profiles.last_seen (added by supabase/presence.sql). If that
    // migration hasn't run yet, the column is missing → fall back gracefully so the
    // whole Discover/Friends/Map feature never breaks.
    let data: any[] | null = null;
    let error: any = null;
    ({ data, error } = await supabase
      .from("profiles")
      .select(`${locationSelect}, last_seen`)
      .limit(500));
    if (error) {
      ({ data, error } = await supabase.from("profiles").select(locationSelect).limit(500));
      if (error) throw error;
    }

    const PRESENCE_WINDOW = 1000 * 90; // "online" if a heartbeat landed in the last 90s
    return (data ?? [])
      .filter((profile: any) => profile.id !== currentUserId)
      .map((profile: any) => {
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
      });
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
      await supabase.from("worker_locations").upsert({
        user_id: user.id,
        lat: point.lat,
        lng: point.lng,
        accuracy: point.accuracy,
        active_app: activeApp,
        today_distance_km: distanceKm,
        today_earnings: earnings,
        updated_at: new Date(point.timestamp).toISOString(),
      });
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
    return (data ?? []).map((message) => ({
      id: message.id,
      threadId: message.thread_id,
      senderId: message.sender_id,
      body: message.body,
      attachmentUrl: message.attachment_url ?? undefined,
      createdAt: new Date(message.created_at).getTime(),
      status: message.status ?? "sent",
    }));
  },

  async createThread(userId: string, title: string, isGroup: boolean): Promise<ChatThread> {
    assertSupabase();
    const { data: thread, error: threadError } = await supabase!
      .from("chat_threads")
      .insert({
        title,
        is_group: isGroup,
        created_by: userId,
      })
      .select("id, title, is_group, updated_at")
      .single();
    if (threadError) throw threadError;

    const { error: memberError } = await supabase!.from("chat_thread_members").insert({
      thread_id: thread.id,
      user_id: userId,
    });
    if (memberError) throw memberError;

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

  async ensureDefaultThreads(userId: string): Promise<ChatThread[]> {
    const existing = await this.loadThreads(userId);
    if (existing.length) return existing;
    const thread = await this.createThread(userId, "Manila Drivers", true);
    return [thread];
  },

  async sendMessage(message: ChatMessage): Promise<void> {
    assertSupabase();
    const { error: insertError } = await supabase!.from("chat_messages").insert({
      id: message.id,
      thread_id: message.threadId,
      sender_id: message.senderId,
      body: message.body,
      attachment_url: message.attachmentUrl ?? null,
      status: message.status,
      created_at: new Date(message.createdAt).toISOString(),
    });
    if (insertError) throw insertError;

    const { error: updateError } = await supabase!
      .from("chat_threads")
      .update({ updated_at: new Date(message.createdAt).toISOString() })
      .eq("id", message.threadId);
    if (updateError) throw updateError;
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
    const { error } = await supabase!
      .from("group_members")
      .upsert({ group_id: groupId, user_id: userId });
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
