import { create } from "zustand";
import { persist } from "zustand/middleware";
import { translate } from "../i18n";
import { NotificationService } from "../services/NotificationService";
import { SupabaseService } from "../services/SupabaseService";
import { useAuthStore } from "./useAuthStore";
import type { AppNotification, NotificationPrefs } from "../types";

/**
 * Does the driver want to be interrupted by this?
 *
 * `system` is always yes — account and security notices are not marketing.
 * Anything else is checked against the switches the server also checks, so a
 * category that is off is off everywhere rather than only for remote push.
 */
function wanted(kind: AppNotification["kind"], prefs: NotificationPrefs): boolean {
  if (kind === "chat") return prefs.chat;
  if (kind === "location") return prefs.location;
  // "job" is community-shaped in practice: likes, comments, connections.
  if (kind === "job") return prefs.social;
  return true;
}

interface NotificationState {
  notifications: AppNotification[];
  loadCloudNotifications: (userId: string) => Promise<void>;
  push: (title: string, description: string, kind?: AppNotification["kind"]) => void;
  /** Which categories the driver wants. Mirrors notification_prefs; the server
   *  holds the authoritative copy because it is the sender. */
  prefs: NotificationPrefs;
  loadPrefs: () => Promise<void>;
  setPref: (key: keyof NotificationPrefs, value: boolean) => Promise<void>;
  markAllRead: () => void;
  remove: (id: string) => void;
}

// Ids we've already surfaced as a device banner, so live reloads don't re-announce.
const announced = new Set<string>();
let firstNotificationLoad = true;

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set, get) => ({
      notifications: [
        NotificationService.create(
          translate("notif_welcomeTitle"),
          translate("notif_welcomeBody"),
          "system",
        ),
      ],
      loadCloudNotifications: async (userId) => {
        try {
          const incoming = await SupabaseService.loadNotifications(userId);
          if (!incoming.length) return;
          if (firstNotificationLoad) {
            // First load after login is existing history — don't pop banners for it.
            firstNotificationLoad = false;
            incoming.forEach((n) => announced.add(n.id));
            set({ notifications: incoming });
            return;
          }
          // Newly-arrived (via live sync) unread notifications get a device banner.
          incoming
            .filter((n) => !n.read && !announced.has(n.id))
            .forEach((n) => {
              announced.add(n.id);
              /* The same switches the server checks, applied to notifications the app
                 raises itself — otherwise the toggle silences push and leaves local
                 ones coming through, which reads as a broken setting. `system` is
                 never suppressed. */
              if (wanted(n.kind, get().prefs)) {
                void NotificationService.sendNative(n).catch(() => undefined);
              }
            });
          set({ notifications: incoming });
        } catch (error) {
          console.warn("Could not load cloud notifications:", error);
        }
      },
      prefs: { chat: true, social: true, location: true, promo: true },

      loadPrefs: async () => {
        const user = useAuthStore.getState().user;
        if (!user) return;
        try {
          set({ prefs: await SupabaseService.loadNotificationPrefs(user.id) });
        } catch (error) {
          console.warn("Could not load notification preferences:", error);
        }
      },

      /* Optimistic, and reverted on failure. A toggle that waits on the network
         before moving feels broken on a bad connection, which is most of the
         time for the people this app is for. */
      setPref: async (key, value) => {
        const user = useAuthStore.getState().user;
        const before = get().prefs;
        const next = { ...before, [key]: value };
        set({ prefs: next });
        if (!user) return;
        try {
          await SupabaseService.saveNotificationPrefs(user.id, next);
        } catch (error) {
          set({ prefs: before });
          throw error;
        }
      },

      push: (title, description, kind = "system") => {
        const notification = NotificationService.create(title, description, kind);
        if (wanted(kind, get().prefs)) {
          void NotificationService.sendNative(notification).catch((error) => {
            console.warn("Could not schedule native notification:", error);
          });
        }
        set((state) => ({
          notifications: [notification, ...state.notifications].slice(0, 20),
        }));
      },
      markAllRead: () =>
        set((state) => ({
          notifications: state.notifications.map((notification) => ({ ...notification, read: true })),
        })),
      remove: (id) =>
        set((state) => ({
          notifications: state.notifications.filter((notification) => notification.id !== id),
        })),
    }),
    { name: "masaya_notifications_v2" },
  ),
);
