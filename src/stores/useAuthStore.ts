import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { UserSession } from "../types";
import { useNotificationStore } from "./useNotificationStore";
import { isSupabaseConfigured, SupabaseService } from "../services/SupabaseService";

interface AuthState {
  user: UserSession | null;
  cloudEnabled: boolean;
  initSession: () => Promise<void>;
  signIn: (phone: string, password: string) => Promise<void>;
  signUp: (phone: string, password: string, fullName: string) => Promise<void>;
  signOut: () => void;
  deleteAccount: () => Promise<void>;
  updateProfile: (updates: Partial<Pick<UserSession, "fullName" | "phone">>) => void;
}

let authListenerRegistered = false;

/**
 * Wipe every per-user cache on this device.
 *
 * Signing out used to clear only `user`, leaving the previous driver's tracked
 * distance, earnings, home address, work platform, challenges, cached chats and
 * notifications behind. On a shared phone — common among gig drivers — the next
 * person to sign in inherited all of it. Language stays: that is a device
 * preference, not personal data.
 */
function clearLocalUserData() {
  const perUserKeys = [
    "masaya_auth",
    "masaya_profile_v2",
    "masaya_location_v2",
    "masaya_chat_v3",
    "masaya_community_v4",
    "masaya_notifications_v2",
    "masaya_jobs_v3",
    // Consent is a person's acknowledgement, so the next driver gives their own.
    "masaya_consent_v2",
  ];
  for (const key of perUserKeys) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Storage can be unavailable (private mode); nothing else to do.
    }
  }
  // The stores also hold this data in memory, so a reload is what actually
  // guarantees the next sign-in starts clean. Reload the CURRENT url rather
  // than navigating to "/auth": inside the Capacitor WebView a hard navigation
  // to a client-side route can 404. With no session the app redirects itself.
  if (typeof window !== "undefined") window.location.reload();
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      cloudEnabled: isSupabaseConfigured,
      initSession: async () => {
        if (!isSupabaseConfigured) return;
        // Register once: if the session expires or is revoked, drop the stale
        // local user so the app falls back to the login screen cleanly.
        if (!authListenerRegistered) {
          authListenerRegistered = true;
          SupabaseService.onSignedOut(() => set({ user: null }));
        }
        if (get().user) return;
        const cloudUser = await SupabaseService.getSessionUser();
        if (cloudUser) set({ user: cloudUser });
      },
      signIn: async (phone, password) => {
        await delay(400);
        if (isSupabaseConfigured) {
          assertPhone(phone);
          if (password.trim().length < 6) {
            throw new Error("Password must be at least 6 characters.");
          }
          const user = await SupabaseService.signIn(phone, password);
          set({ user });
          await SupabaseService.ensureDefaultThreads(user.id);
          useNotificationStore
            .getState()
            .push("Welcome back!", "You have successfully logged in.", "system");
          return;
        }
        // No offline/demo sign-in. This used to mint a local "Codex Demo Driver"
        // from a hardcoded phone and password, which shipped inside the APK —
        // a build made without the Supabase env would have let anyone in with
        // empty fields. Fail loudly instead.
        throw new Error("Sign-in is unavailable: the app is not configured. Please reinstall.");
      },
      signUp: async (phone, password, fullName) => {
        await delay(500);
        if (password.trim().length < 6) throw new Error("Password must be at least 6 characters.");
        if (fullName.trim().length < 2) throw new Error("Name must be at least 2 characters.");
        if (isSupabaseConfigured) {
          assertPhone(phone);
          const user = await SupabaseService.signUp(phone, password, fullName);
          set({ user });
          await SupabaseService.ensureDefaultThreads(user.id);
          useNotificationStore.getState().push("Account created!", "Welcome to Buzz Buzz!", "system");
          return;
        }
        // Same reasoning as signIn: no local-only accounts. An account that
        // exists on one phone and nowhere else is worse than a clear failure.
        throw new Error("Sign-up is unavailable: the app is not configured. Please reinstall.");
      },
      signOut: async () => {
        // Clear local state first so logout is instant and reliable even if the
        // network is flaky; then revoke the cloud session as best-effort.
        set({ user: null });
        try {
          await SupabaseService.signOut();
        } catch (error) {
          console.warn("Cloud sign-out failed:", error);
        }
        // Nothing of this driver may survive for whoever signs in next.
        clearLocalUserData();
      },
      deleteAccount: async () => {
        if (isSupabaseConfigured) {
          await SupabaseService.deleteAccount();
        }
        set({ user: null });
        clearLocalUserData();
      },
      updateProfile: (updates) => {
        const user = get().user;
        if (user)
          void SupabaseService.updateProfile(user, updates).catch((error) => {
            console.warn("Could not sync profile to cloud:", error);
          });
        set((state) => ({
          user: state.user ? { ...state.user, ...updates } : state.user,
        }));
      },
    }),
    { name: "masaya_auth" },
  ),
);

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function assertPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) {
    throw new Error("Enter a valid phone number (at least 10 digits).");
  }
}
