import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { PushNotifications } from "@capacitor/push-notifications";
import type { AppNotification } from "../types";
import { uid } from "../utils/format";
import { SupabaseService } from "./SupabaseService";

let pushInitialized = false;

export const NotificationService = {
  create(
    title: string,
    description: string,
    kind: AppNotification["kind"] = "system",
  ): AppNotification {
    return {
      id: uid("notice"),
      title,
      description,
      kind,
      createdAt: Date.now(),
      read: false,
    };
  },

  async sendNative(notification: AppNotification) {
    if (!Capacitor.isNativePlatform()) return;
    const permission = await LocalNotifications.requestPermissions();
    if (permission.display !== "granted") return;
    await LocalNotifications.schedule({
      notifications: [
        {
          id: Math.abs(hashCode(notification.id)),
          title: notification.title,
          body: notification.description,
          schedule: { at: new Date(Date.now() + 250) },
          extra: { kind: notification.kind },
        },
      ],
    });
  },

  async initPush(userId: string) {
    // Remote push needs Firebase (google-services.json). Registering without it
    // crashes on Android and can't be caught in JS, so stay off until push is
    // explicitly enabled (set VITE_ENABLE_PUSH=true after Firebase setup — see
    // supabase/PUSH_SETUP.md). Local/in-app notifications work regardless.
    if (import.meta.env.VITE_ENABLE_PUSH !== "true") return;
    if (!Capacitor.isNativePlatform() || pushInitialized) return;
    pushInitialized = true;

    try {
      const permission = await PushNotifications.requestPermissions();
      if (permission.receive !== "granted") return;

      await PushNotifications.register();

      await PushNotifications.addListener("registration", (event) => {
        if (!SupabaseService.enabled || !event.value) return;
        void SupabaseService.savePushToken(userId, event.value).catch(() => undefined);
      });

      await PushNotifications.addListener("pushNotificationReceived", (notification) => {
        void NotificationService.sendNative(
          NotificationService.create(
            notification.title ?? "Buzz Buzz",
            notification.body ?? "You have a new notification.",
            "system",
          ),
        ).catch(() => undefined);
      });
    } catch (error) {
      // Allow a retry on the next session if push setup failed.
      pushInitialized = false;
      console.warn("Push notification setup failed:", error);
    }
  },
};

function hashCode(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return hash || Date.now();
}
