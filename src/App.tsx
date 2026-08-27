import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { ConsentGate } from "./components/ConsentGate";
import { Toasts } from "./components/Toasts";
import { NotificationService } from "./services/NotificationService";
import { SupabaseService } from "./services/SupabaseService";
import { useAuthStore } from "./stores/useAuthStore";
import { useChatStore } from "./stores/useChatStore";
import { useCommunityStore } from "./stores/useCommunityStore";
import { useLocationStore } from "./stores/useLocationStore";
import { useNotificationStore } from "./stores/useNotificationStore";
import { useProfileStore } from "./stores/useProfileStore";
import { applyDirection, useLangStore } from "./i18n";
import { countryToCurrency, resolveCountry } from "./i18n/region";
import { AuthScreen } from "./screens/AuthScreen";
import { CommunityScreen } from "./screens/CommunityScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { MessagesScreen } from "./screens/MessagesScreen";
import { NotificationsScreen } from "./screens/NotificationsScreen";
import { PrivacyScreen } from "./screens/PrivacyScreen";
import { ProfileScreen } from "./screens/ProfileScreen";
import { RoutesScreen } from "./screens/RoutesScreen";
import { TermsScreen } from "./screens/TermsScreen";

export default function App() {
  const user = useAuthStore((state) => state.user);
  const initSession = useAuthStore((state) => state.initSession);
  const isTracking = useLocationStore((state) => state.isTracking);
  const tickElapsed = useLocationStore((state) => state.tickElapsed);
  const ensureToday = useLocationStore((state) => state.ensureToday);
  const loadCloudSettings = useProfileStore((state) => state.loadCloudSettings);
  const loadCloudCommunity = useCommunityStore((state) => state.loadCloudCommunity);
  const loadConnections = useCommunityStore((state) => state.loadConnections);
  const loadCloudChats = useChatStore((state) => state.loadCloudChats);
  const loadCloudNotifications = useNotificationStore((state) => state.loadCloudNotifications);
  const autoRegion = useLangStore((state) => state.autoRegion);
  const lang = useLangStore((state) => state.lang);

  // Apply text direction (RTL for Arabic) whenever the language changes.
  useEffect(() => {
    applyDirection(lang);
  }, [lang]);

  useEffect(() => {
    void initSession();
  }, [initSession]);

  // Auto currency from the user's region (device locale; refined by GPS on the map).
  // Language defaults to English and only changes when the user picks one manually.
  useEffect(() => {
    if (!autoRegion) return;
    useProfileStore.getState().applyCurrency(countryToCurrency(resolveCountry()));
  }, [autoRegion]);

  // Reset "today's" distance/earnings when the day rolls over (on open + on refocus).
  useEffect(() => {
    ensureToday();
    const onVisible = () => {
      if (document.visibilityState === "visible") ensureToday();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [ensureToday]);

  useEffect(() => {
    if (!isTracking) return undefined;
    const timer = window.setInterval(tickElapsed, 60000);
    return () => window.clearInterval(timer);
  }, [isTracking, tickElapsed]);

  // Presence heartbeat: mark the user "seen" now (immediately on open), then every 45s
  // while the app is foregrounded, so other drivers get live WhatsApp-style online /
  // last-seen status. When the app is backgrounded the beat stops → last_seen freezes
  // → others see "last seen X ago".
  useEffect(() => {
    if (!user || !SupabaseService.enabled) return undefined;
    const beat = (force = false) => {
      if (force || document.visibilityState === "visible") {
        void SupabaseService.updateLastSeen(user.id).catch(() => undefined);
      }
    };
    beat(true);
    const timer = window.setInterval(() => beat(), 45000);
    const onVisible = () => beat();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user]);

  useEffect(() => {
    if (!user || !SupabaseService.enabled) return undefined;
    void loadCloudSettings(user.id);
    void loadCloudCommunity();
    void loadConnections(user.id);
    void loadCloudChats(user.id);
    void loadCloudNotifications(user.id);
    void NotificationService.initPush(user.id);
    void SupabaseService.refreshRealtimeAuth();

    const unsubscribe = [
      SupabaseService.subscribeToTable("feed_posts", () => void loadCloudCommunity()),
      SupabaseService.subscribeToTable("post_likes", () => void loadCloudCommunity()),
      SupabaseService.subscribeToTable("post_reposts", () => void loadCloudCommunity()),
      SupabaseService.subscribeToTable("post_comments", () => void loadCloudCommunity()),
      SupabaseService.subscribeToTable("worker_locations", () => void loadCloudCommunity()),
      SupabaseService.subscribeToTable("chat_messages", () => void loadCloudChats(user.id)),
      SupabaseService.subscribeToTable("notifications", () => void loadCloudNotifications(user.id)),
      SupabaseService.subscribeToTable("connections", () => void loadConnections(user.id)),
    ];
    return () => unsubscribe.forEach((fn) => fn());
  }, [
    loadCloudChats,
    loadCloudCommunity,
    loadConnections,
    loadCloudNotifications,
    loadCloudSettings,
    user,
  ]);

  // Poll notifications and connections while the app is open.
  //
  // The realtime subscriptions above are the fast path, but they are not a
  // guarantee: verified with two drivers that a chat notification sat in the
  // database and never reached the bell until the app was fully reloaded. For a
  // driver app a missed message notification is not cosmetic. Refreshing on
  // return to the foreground matters as much as the timer — that is when a
  // driver actually looks.
  useEffect(() => {
    if (!user || !SupabaseService.enabled) return undefined;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      void loadCloudNotifications(user.id);
      void loadConnections(user.id);
    };
    const timer = window.setInterval(refresh, 20000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [user, loadCloudNotifications, loadConnections]);


  return (
    <>
      <ConsentGate />
      <Routes>
        <Route path="/auth" element={<AuthScreen />} />
        <Route path="/privacy" element={<PrivacyScreen />} />
        <Route path="/terms" element={<TermsScreen />} />
        <Route
          path="/home"
          element={
            <AppShell title="Buzz">
              <HomeScreen />
            </AppShell>
          }
        />
        <Route
          path="/community"
          element={
            <AppShell title="Community" header={false}>
              <CommunityScreen />
            </AppShell>
          }
        />
        <Route
          path="/routes"
          element={
            <AppShell title="Routes" header={false}>
              <RoutesScreen />
            </AppShell>
          }
        />
        <Route
          path="/messages"
          element={
            <AppShell title="Messages">
              <MessagesScreen />
            </AppShell>
          }
        />
        <Route
          path="/profile"
          element={
            <AppShell title="Profile">
              <ProfileScreen />
            </AppShell>
          }
        />
        <Route
          path="/notifications"
          element={
            <AppShell title="Notifications">
              <NotificationsScreen />
            </AppShell>
          }
        />
        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
      <Toasts />
    </>
  );
}
