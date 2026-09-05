import { create } from "zustand";
import { persist } from "zustand/middleware";
import { seededChallenges, seededGroups, seededPosts, seededWorkers } from "../data/seed";
import { SupabaseService } from "../services/SupabaseService";
import { Outbox, blobToDataUrl } from "../services/Outbox";
import type { PickedPhoto, PickedVideo } from "../services/MediaService";
import type {
  Challenge,
  ChallengeMetric,
  Connection,
  ConnectionState,
  FeedPost,
  Group,
  PostComment,
  Worker,
} from "../types";
import { initials, uid } from "../utils/format";
import { useAuthStore } from "./useAuthStore";

interface CommunityState {
  posts: FeedPost[];
  workers: Worker[];
  challenges: Challenge[];
  groups: Group[];
  comments: Record<string, PostComment[]>;
  connections: Connection[];
  loaded: boolean;
  /** True once member counts came from the cloud. While false the counts are
   *  unknown (offline / tables missing) and must NOT be shown as if real. */
  groupsFromCloud: boolean;
  loadCloudCommunity: () => Promise<void>;
  addPost: (body: string, photo?: PickedPhoto, video?: PickedVideo) => void;
  toggleLike: (postId: string) => void;
  toggleRepost: (postId: string) => void;
  deletePost: (postId: string) => Promise<void>;
  loadComments: (postId: string) => Promise<void>;
  addComment: (postId: string, body: string) => Promise<void>;
  loadConnections: (userId: string) => Promise<void>;
  sendConnection: (workerId: string) => Promise<void>;
  acceptConnection: (connectionId: string) => Promise<void>;
  toggleChallenge: (id: string) => void;
  toggleGroup: (id: string) => void;
  /** Ids of people this driver has blocked. Their posts, comments and messages
   *  are filtered out everywhere content is shown. */
  blocked: string[];
  /** Post ids this driver has saved. Ids rather than posts: the Activity
   *  screen fetches the posts, because a save from three weeks ago is not in
   *  the loaded feed. */
  bookmarks: string[];
  loadBlocks: () => Promise<void>;
  blockUser: (userId: string) => Promise<void>;
  unblockUser: (userId: string) => Promise<void>;
  loadBookmarks: () => Promise<void>;
  toggleBookmark: (postId: string) => Promise<void>;
  reportContent: (input: {
    targetType: "post" | "message" | "user";
    targetId: string;
    targetUser?: string;
    reason: "spam" | "harassment" | "hate" | "violence" | "sexual" | "other";
    note?: string;
    excerpt?: string;
  }) => Promise<void>;
}

export const useCommunityStore = create<CommunityState>()(
  persist(
    (set, get) => ({
      posts: seededPosts,
      workers: seededWorkers,
      challenges: seededChallenges,
      groups: seededGroups,
      comments: {},
      connections: [],
      loaded: false,
      groupsFromCloud: false,
      blocked: [],
      bookmarks: [],
      loadCloudCommunity: async () => {
        const user = useAuthStore.getState().user;
        try {
          const [posts, workers, blocked] = await Promise.all([
            SupabaseService.loadPosts(user?.id),
            SupabaseService.loadWorkers(user?.id),
            user ? SupabaseService.loadBlocks(user.id) : Promise.resolve([]),
          ]);
          set((state) => ({
            posts: posts.length ? posts : state.posts,
            workers: workers.length ? workers : state.workers,
            // Always take the server's list, including when it is empty — an
            // unblock elsewhere has to be able to clear this one.
            blocked: user ? blocked : state.blocked,
          }));
        } catch (error) {
          console.warn("Could not load community feed:", error);
        } finally {
          set({ loaded: true });
        }
        // Real groups live in the cloud; keep the seeded list if the groups
        // tables haven't been created yet so the tab never breaks.
        try {
          const groups = await SupabaseService.loadGroups(user?.id);
          if (groups.length) set({ groups, groupsFromCloud: true });
        } catch (error) {
          // Leave groupsFromCloud false so the UI hides counts rather than
          // presenting the offline fallback numbers as real membership.
          console.warn("Could not load groups:", error);
        }
      },
      addPost: (body, photo, video) => {
        const user = useAuthStore.getState().user;
        const tempId = uid("post");
        const optimistic: FeedPost = {
          id: tempId,
          userId: user?.id,
          author: user?.fullName ?? "Driver",
          initials: initials(user?.fullName ?? "Driver"),
          body,
          // Show the local file immediately; it is replaced by the stored URL
          // once the upload lands.
          imageUrl: photo?.preview,
          imageThumbUrl: photo?.preview,
          // A reel shows its local file straight away too, so the driver sees
          // it in the tab before the upload finishes.
          videoUrl: video?.preview,
          likes: 0,
          likedByMe: false,
          reposts: 0,
          repostedByMe: false,
          commentCount: 0,
          createdAt: Date.now(),
        };
        set((state) => ({ posts: [optimistic, ...state.posts] }));
        if (!user || !SupabaseService.enabled) return;

        void (async () => {
          try {
            const image = photo
              ? await SupabaseService.uploadPhoto(user.id, photo)
              : undefined;
            const videoUrl = video
              ? await SupabaseService.uploadVideo(user.id, video)
              : undefined;
            const real = await SupabaseService.addPost(user.id, body, image, videoUrl);
            // Swap the temp post for the saved one so its real id is usable for
            // likes and comments immediately.
            if (real)
              set((state) => ({
                posts: state.posts.map((p) => (p.id === tempId ? real : p)),
              }));
          } catch {
            // No signal, or the upload failed. Queue it rather than lose it —
            // the post stays visible and goes out when the connection returns.
            const queued = Outbox.add({
              kind: "post",
              userId: user.id,
              body,
              photo: photo
                ? {
                    full: await blobToDataUrl(photo.full),
                    thumb: await blobToDataUrl(photo.thumb),
                  }
                : undefined,
            });
            set((state) => ({
              posts: state.posts.map((p) =>
                p.id === tempId ? { ...p, pending: queued } : p,
              ),
            }));
          }
        })();
      },
      toggleLike: (postId) => {
        const user = useAuthStore.getState().user;
        const current = get().posts.find((p) => p.id === postId);
        if (!current) return;
        const liked = !current.likedByMe;
        const delta = liked ? 1 : -1;
        set((state) => ({
          posts: state.posts.map((p) =>
            p.id === postId ? { ...p, likedByMe: liked, likes: Math.max(0, p.likes + delta) } : p,
          ),
        }));
        if (user && SupabaseService.enabled)
          void SupabaseService.setLike(postId, user.id, liked).catch((error) => {
            // Revert on failure.
            set((state) => ({
              posts: state.posts.map((p) =>
                p.id === postId
                  ? { ...p, likedByMe: !liked, likes: Math.max(0, p.likes - delta) }
                  : p,
              ),
            }));
            console.warn("Could not update like:", error);
          });
      },
      toggleRepost: (postId) => {
        const user = useAuthStore.getState().user;
        const current = get().posts.find((p) => p.id === postId);
        if (!current) return;
        const reposted = !current.repostedByMe;
        const delta = reposted ? 1 : -1;
        set((state) => ({
          posts: state.posts.map((p) =>
            p.id === postId
              ? { ...p, repostedByMe: reposted, reposts: Math.max(0, p.reposts + delta) }
              : p,
          ),
        }));
        if (user && SupabaseService.enabled)
          void SupabaseService.setRepost(postId, user.id, reposted).catch((error) => {
            // Revert on failure, exactly as a like does.
            set((state) => ({
              posts: state.posts.map((p) =>
                p.id === postId
                  ? { ...p, repostedByMe: !reposted, reposts: Math.max(0, p.reposts - delta) }
                  : p,
              ),
            }));
            console.warn("Could not update repost:", error);
          });
      },
      deletePost: async (postId) => {
        const user = useAuthStore.getState().user;
        const previous = get().posts;
        // Optimistic: drop it immediately, restore if the cloud refuses.
        set((state) => ({ posts: state.posts.filter((p) => p.id !== postId) }));
        if (!user || !SupabaseService.enabled) return;
        try {
          await SupabaseService.deletePost(postId, user.id);
        } catch (error) {
          set({ posts: previous });
          console.warn("Could not delete post:", error);
        }
      },
      loadComments: async (postId) => {
        if (!SupabaseService.enabled) return;
        try {
          const comments = await SupabaseService.loadComments(postId);
          set((state) => ({ comments: { ...state.comments, [postId]: comments } }));
        } catch (error) {
          console.warn("Could not load comments:", error);
        }
      },
      addComment: async (postId, body) => {
        const user = useAuthStore.getState().user;
        if (!user) return;
        if (!SupabaseService.enabled) {
          const local: PostComment = {
            id: uid("comment"),
            postId,
            author: user.fullName,
            initials: initials(user.fullName),
            body,
            createdAt: Date.now(),
          };
          set((state) => ({
            comments: { ...state.comments, [postId]: [...(state.comments[postId] ?? []), local] },
            posts: state.posts.map((p) =>
              p.id === postId ? { ...p, commentCount: p.commentCount + 1 } : p,
            ),
          }));
          return;
        }
        try {
          const comment = await SupabaseService.addComment(postId, user.id, body);
          set((state) => ({
            comments: {
              ...state.comments,
              [postId]: [...(state.comments[postId] ?? []), comment],
            },
            posts: state.posts.map((p) =>
              p.id === postId ? { ...p, commentCount: p.commentCount + 1 } : p,
            ),
          }));
        } catch (error) {
          console.warn("Could not add comment:", error);
        }
      },
      loadConnections: async (userId) => {
        if (!SupabaseService.enabled) return;
        try {
          const connections = await SupabaseService.loadConnections(userId);
          set({ connections });
        } catch (error) {
          console.warn("Could not load connections:", error);
        }
      },
      sendConnection: async (workerId) => {
        const user = useAuthStore.getState().user;
        if (!user || !SupabaseService.enabled) return;
        try {
          const connection = await SupabaseService.sendConnection(user.id, workerId);
          set((state) => ({ connections: [...state.connections, connection] }));
        } catch (error) {
          console.warn("Could not send connection request:", error);
        }
      },
      acceptConnection: async (connectionId) => {
        if (!SupabaseService.enabled) return;
        try {
          await SupabaseService.acceptConnection(connectionId);
          set((state) => ({
            connections: state.connections.map((c) =>
              c.id === connectionId ? { ...c, status: "accepted" } : c,
            ),
          }));
        } catch (error) {
          console.warn("Could not accept connection:", error);
        }
      },
      toggleChallenge: (id) =>
        set((state) => ({
          challenges: state.challenges.map((challenge) =>
            challenge.id === id ? { ...challenge, joined: !challenge.joined } : challenge,
          ),
        })),
      loadBookmarks: async () => {
        const user = useAuthStore.getState().user;
        if (!user) return;
        try {
          set({ bookmarks: await SupabaseService.loadBookmarkIds(user.id) });
        } catch (error) {
          console.warn("Could not load bookmarks:", error);
        }
      },

      /* Optimistic, like the like button beside it. Saving is a small, private
         act and it should feel instant; a failed write puts the icon back. */
      toggleBookmark: async (postId) => {
        const user = useAuthStore.getState().user;
        if (!user) return;
        const before = get().bookmarks;
        const saving = !before.includes(postId);
        set({ bookmarks: saving ? [postId, ...before] : before.filter((id) => id !== postId) });
        try {
          await SupabaseService.toggleBookmark(user.id, postId, saving);
        } catch (error) {
          set({ bookmarks: before });
          throw error;
        }
      },

      loadBlocks: async () => {
        const user = useAuthStore.getState().user;
        if (!user) return;
        try {
          set({ blocked: await SupabaseService.loadBlocks(user.id) });
        } catch (error) {
          console.warn("Could not load block list:", error);
        }
      },

      /* Optimistic on purpose. Blocking is something people do when they want
         someone gone NOW; waiting on a round trip to stop showing the content
         is the wrong feel. Reverted if the write fails. */
      blockUser: async (userId) => {
        const user = useAuthStore.getState().user;
        if (!user || userId === user.id) return;
        const before = get().blocked;
        if (before.includes(userId)) return;
        set({ blocked: [...before, userId] });
        try {
          await SupabaseService.blockUser(user.id, userId);
        } catch (error) {
          set({ blocked: before });
          throw error;
        }
      },

      unblockUser: async (userId) => {
        const user = useAuthStore.getState().user;
        if (!user) return;
        const before = get().blocked;
        set({ blocked: before.filter((id) => id !== userId) });
        try {
          await SupabaseService.unblockUser(user.id, userId);
        } catch (error) {
          set({ blocked: before });
          throw error;
        }
      },

      reportContent: async (input) => {
        const user = useAuthStore.getState().user;
        if (!user) return;
        await SupabaseService.reportContent({ reporterId: user.id, ...input });
      },

      toggleGroup: (id) => {
        const user = useAuthStore.getState().user;
        const group = get().groups.find((g) => g.id === id);
        if (!group) return;
        const joining = !group.joined;
        const flip = (dir: 1 | -1, joined: boolean) =>
          set((state) => ({
            groups: state.groups.map((g) =>
              g.id === id ? { ...g, joined, members: Math.max(0, g.members + dir) } : g,
            ),
          }));
        flip(joining ? 1 : -1, joining);
        if (!user || !SupabaseService.enabled) return;
        const call = joining
          ? SupabaseService.joinGroup(id, user.id)
          : SupabaseService.leaveGroup(id, user.id);
        void call.catch((error) => {
          // Revert the optimistic flip if the cloud write failed.
          flip(joining ? -1 : 1, !joining);
          console.warn("Could not update group membership:", error);
        });
      },
    }),
    {
      name: "masaya_community_v4",
      // Cloud data (posts/workers/comments/connections) is refetched on load;
      // only persist the local-only challenges and groups.
      partialize: (state) => ({ challenges: state.challenges, groups: state.groups }),
      version: 2,
      // v1: the earnings challenge title had a hardcoded "₱" that showed to
      // drivers on every other currency. Swap it for the {amount} token so it
      // renders in their own currency.
      //
      // v2: driver-created challenges are gone. They were only ever written to
      // this device — there is no challenges table — so one could not be seen
      // or joined by anybody else while sitting in a list of challenges that
      // could. Any already saved are dropped here: leaving them would strand
      // rows nothing can now delete, since the control that removed them went
      // with the feature.
      migrate: (persisted, version) => {
        const state = persisted as { challenges?: Challenge[] } | undefined;
        if (version < 1 && state?.challenges) {
          state.challenges = state.challenges.map((challenge) =>
            challenge.id === "challenge_earn"
              ? { ...challenge, title: "{amount} Weekly Run" }
              : challenge,
          );
        }
        if (version < 2 && state?.challenges) {
          state.challenges = state.challenges.filter((challenge) => !challenge.custom);
        }
        return state as never;
      },
    },
  ),
);

// Derives the connection state between the current user and a given worker.
export function connectionFor(
  connections: Connection[],
  userId: string | undefined,
  workerId: string,
): { state: ConnectionState; connection?: Connection } {
  if (!userId) return { state: "none" };
  const connection = connections.find(
    (c) =>
      (c.requesterId === userId && c.addresseeId === workerId) ||
      (c.requesterId === workerId && c.addresseeId === userId),
  );
  if (!connection) return { state: "none" };
  if (connection.status === "accepted") return { state: "connected", connection };
  return {
    state: connection.requesterId === userId ? "pending_out" : "pending_in",
    connection,
  };
}
