import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { ConsentGate } from "./components/ConsentGate";
import { APP_NAME } from "./config/constants";
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
import { countryToCurrency, resolveCountryForLocation } from "./i18n/region";
import { AuthScreen } from "./screens/AuthScreen";
import { CommunityScreen } from "./screens/CommunityScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { MessagesScreen } from "./screens/MessagesScreen";
import { NotificationsScreen } from "./screens/NotificationsScreen";
import { PrivacyScreen } from "./screens/PrivacyScreen";
import { ActivityScreen } from "./screens/ActivityScreen";
import { ProfileScreen } from "./screens/ProfileScreen";
import { RoutesScreen } from "./screens/RoutesScreen";
import { TermsScreen } from "./screens/TermsScreen";

export default function App() {
  const user = useAuthStore((state) => state.user);
  const initSession = useAuthStore((state) => state.initSession);
  const isTracking = useLocationStore((state) => state.isTracking);
  const tickElapsed = useLocationStore((state) => state.tickElapsed);
  const ensureToday = useLocationStore((state) => state.ensureToday);
  const hydrateFromServer = useLocationStore((state) => state.hydrateFromServer);
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

  /* Auto currency from where the driver IS, refined by GPS once the map has a
     fix. Timezone first, locale second: this used to read the locale, so a
     driver in Mumbai on an en-US handset — which is most of them — saw $10/km
     under a toggle that says "by location", and kept seeing it until the day
     they happened to open the map. The timezone follows the phone.
     Language is deliberately not decided here; that one IS a preference. */
  useEffect(() => {
    if (!autoRegion) return;
    useProfileStore.getState().applyCurrency(countryToCurrency(resolveCountryForLocation()));
  }, [autoRegion]);

  /* Reset "today's" distance/earnings when the day rolls over (on open + on
     refocus), then load the real figure back from the server.
     
     Order matters: ensureToday() first, so a stale total from yesterday is
     zeroed before hydrate takes the larger of local and server and would
     otherwise carry it forward. Hydrating on refocus as well as on open is what
     catches the driver who recorded distance on their phone and then opened the
     app somewhere else. */
  useEffect(() => {
    ensureToday();
    void hydrateFromServer();
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      ensureToday();
      void hydrateFromServer();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [ensureToday, hydrateFromServer]);

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
    /* Keyed on the id, not the object. The auth store hands back a fresh `user`
       whenever the profile or the token refreshes, and depending on the object
       tore this effect down and rebuilt it each time — firing beat(true) again
       on every rebuild. That is most of why one sign-in produced eight presence
       writes rather than one. */
  }, [user?.id]);

  useEffect(() => {
    if (!user || !SupabaseService.enabled) return undefined;
    void loadCloudSettings(user.id);
    void loadCloudCommunity();
    void loadConnections(user.id);
    void loadCloudChats(user.id);
    /* Favourites live on the server now, so they follow a driver to a new
       handset rather than staying on the cracked one. */
    void useChatStore.getState().loadFavourites(user.id);
    void loadCloudNotifications(user.id);
    // Load the switches before push registers, so a driver who has turned a
    // category off is not interrupted on the way in.
    void useNotificationStore.getState().loadPrefs();
    void useCommunityStore.getState().loadBlocks();
    void useCommunityStore.getState().loadBookmarks();
    void NotificationService.initPush(user.id);

    /* Realtime has to carry the driver's token BEFORE anything subscribes.
     *
     * refreshRealtimeAuth awaits getSession, so `void`-ing it and creating the
     * channels on the next line is a race the channels always lose: they join
     * unauthenticated, and postgres_changes on these RLS-heavy tables then
     * delivers nothing at all — silently, with the channel still reporting
     * SUBSCRIBED. Measured: zero events on an unauthenticated channel, and the
     * insert arriving normally on the same channel once setAuth had run. The
     * app was falling back to its polling timers for everything, which is why
     * an incoming message took up to nine seconds to appear.
     *
     * Subscriptions are built after the token lands. `cancelled` covers the
     * driver navigating away or signing out in that window, so a channel is
     * never created after the effect has been torn down. */
    let cancelled = false;
    let unsubscribe: Array<() => void> = [];

    void (async () => {
      await SupabaseService.refreshRealtimeAuth();
      if (cancelled) return;
      unsubscribe = [
      SupabaseService.subscribeToTable("feed_posts", () => void loadCloudCommunity()),
      SupabaseService.subscribeToTable("post_likes", () => void loadCloudCommunity()),
      SupabaseService.subscribeToTable("post_reposts", () => void loadCloudCommunity()),
      SupabaseService.subscribeToTable("post_comments", () => void loadCloudCommunity()),
      SupabaseService.subscribeToTable("worker_locations", () => void loadCloudCommunity()),
      SupabaseService.subscribeToTable("chat_messages", () => void loadCloudChats(user.id)),
      SupabaseService.subscribeToTable("notifications", () => void loadCloudNotifications(user.id)),
      SupabaseService.subscribeToTable("connections", () => void loadConnections(user.id)),
      ];
    })();

    return () => {
      cancelled = true;
      unsubscribe.forEach((fn) => fn());
    };
    /* Keyed on the id, not the object — the same trap the presence heartbeat
       was in. The auth store hands back a fresh `user` whenever the profile or
       the token refreshes, and depending on the object tore this effect down
       and rebuilt it each time. That was survivable while the subscriptions
       were created synchronously; it is fatal now that they are created after
       an await, because a rebuild sets `cancelled` on the pending one and the
       replacement gets cancelled in its turn. With the object churning, no
       channel ever survived long enough to join — the app reported zero
       channels and a disconnected socket, and every live surface sat on its
       polling timer. */
  }, [
    loadCloudChats,
    loadCloudCommunity,
    loadConnections,
    loadCloudNotifications,
    loadCloudSettings,
    user?.id,
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
            <AppShell title={APP_NAME}>
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
        <Route
          path="/activity"
          element={
            <AppShell title="Activity">
              <ActivityScreen />
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
