import { create } from "zustand";
import { persist } from "zustand/middleware";
import { translate } from "../i18n";
import { NotificationService } from "../services/NotificationService";
import { SupabaseService } from "../services/SupabaseService";
import type { AppNotification } from "../types";

interface NotificationState {
  notifications: AppNotification[];
  loadCloudNotifications: (userId: string) => Promise<void>;
  push: (title: string, description: string, kind?: AppNotification["kind"]) => void;
  markAllRead: () => void;
  remove: (id: string) => void;
}

// Ids we've already surfaced as a device banner, so live reloads don't re-announce.
const announced = new Set<string>();
let firstNotificationLoad = true;

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set) => ({
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
              void NotificationService.sendNative(n).catch(() => undefined);
            });
          set({ notifications: incoming });
        } catch (error) {
          console.warn("Could not load cloud notifications:", error);
        }
      },
      push: (title, description, kind = "system") => {
        const notification = NotificationService.create(title, description, kind);
        void NotificationService.sendNative(notification).catch((error) => {
          console.warn("Could not schedule native notification:", error);
        });
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
