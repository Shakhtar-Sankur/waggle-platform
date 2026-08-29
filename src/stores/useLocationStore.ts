import { create } from "zustand";
import { persist } from "zustand/middleware";
import { MANILA_CENTER } from "../config/constants";
import { LocationService, MAX_PLAUSIBLE_KMH } from "../services/LocationService";
import { SupabaseService } from "../services/SupabaseService";
import type { LocationPoint } from "../types";
import { useAuthStore } from "./useAuthStore";
import { useNotificationStore } from "./useNotificationStore";
import { useProfileStore } from "./useProfileStore";
import { translate } from "../i18n";

type PermissionState = "idle" | "granted" | "denied";

interface LocationState {
  currentLocation: LocationPoint;
  route: LocationPoint[];
  isTracking: boolean;
  permission: PermissionState;
  elapsedMinutes: number;
  totalDistanceKm: number;
  activeDate: string;
  /** ISO week key (e.g. "2026-W28") the weekly totals belong to. */
  activeWeek: string;
  /** Rolling this-week totals — drive the Strava-style challenge progress. */
  weekDistanceKm: number;
  weekEarnings: number;
  startTracking: () => Promise<void>;
  stopTracking: () => void;
  updatePosition: (point: LocationPoint) => void;
  /**
   * Record where the driver is without treating it as travel.
   *
   * updatePosition is the tracking path: it gates the fix, appends it to the
   * route, adds the delta to the day's distance and syncs it. A screen that
   * merely wants to know where "here" is — to centre a map, or to measure how
   * far away a friend is — must not do any of that.
   */
  setCurrentLocation: (point: LocationPoint) => void;
  tickElapsed: () => void;
  resetRoute: () => void;
  ensureToday: () => void;
}

const initialPoint: LocationPoint = {
  ...MANILA_CENTER,
  accuracy: 80,
  timestamp: Date.now(),
  // This is a guess until a real fix replaces it, and callers that measure
  // FROM it need to know — the friends list was reporting distances computed
  // against this point as though they were real.
  fallback: true,
};

// Local calendar day, e.g. "2026-07-12". Used so "today's" distance/earnings reset daily.
function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

// Monday-based week key, e.g. "2026-W28". Weekly challenge totals reset when it changes.
function weekKey(): string {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  return `${monday.getFullYear()}-${monday.getMonth() + 1}-${monday.getDate()}`;
}

/** Consumer GPS drifts ~5–15 m while stationary; below this we treat it as noise. */
const MIN_MOVE_KM = 0.015; // 15 m
/* MAX_PLAUSIBLE_KMH now lives in LocationService, because the replay of a past
   day needs the same threshold and two copies would drift apart. */

let stopWatching: (() => void) | null = null;
let trackingStartedAt: number | null = null;

export const useLocationStore = create<LocationState>()(
  persist(
    (set, get) => ({
      currentLocation: initialPoint,
      route: [],
      isTracking: false,
      permission: "idle",
      elapsedMinutes: 0,
      totalDistanceKm: 0,
      activeDate: todayKey(),
      activeWeek: weekKey(),
      weekDistanceKm: 0,
      weekEarnings: 0,
      startTracking: async () => {
        try {
          const point = await LocationService.currentPosition();
          stopWatching?.();
          stopWatching = await LocationService.watchPosition((next) => {
            get().updatePosition(next);
          });
          trackingStartedAt = Date.now();
          set({
            currentLocation: point,
            route: [point],
            isTracking: true,
            permission: "granted",
            elapsedMinutes: 0,
            totalDistanceKm: 0,
            activeDate: todayKey(),
          });
          syncLocation(point, 0);
          useNotificationStore
            .getState()
            .push(translate("notif_gpsActive"), translate("notif_gpsActiveBody"), "location");
        } catch (error) {
          set({ permission: "denied", isTracking: false });
          useNotificationStore
            .getState()
            .push(
              "GPS unavailable",
              error instanceof Error ? error.message : "Could not start location tracking.",
              "location",
            );
        }
      },
      stopTracking: () => {
        stopWatching?.();
        stopWatching = null;
        trackingStartedAt = null;
        set({ isTracking: false });
        useNotificationStore.getState().push(translate("notif_sessionEnded"), translate("notif_sessionEndedBody"), "location");
      },
      updatePosition: (point) => {
        const state = get();
        if (!state.isTracking) return;
        const last = state.route[state.route.length - 1];
        if (last) {
          const moved = LocationService.betweenKm(last, point);
          // Earnings are paid per kilometre, so phantom distance is phantom
          // money. A phone sitting still still reports GPS fixes that wander by
          // 5–15 m, which previously accumulated all day while parked or at a
          // red light. Ignore anything below the noise floor…
          if (moved < MIN_MOVE_KM) return;
          // …and reject teleports (a lost then re-acquired fix), which would
          // otherwise credit a driver kilometres they never drove.
          const seconds = Math.max(1, (point.timestamp - last.timestamp) / 1000);
          if (moved / (seconds / 3600) > MAX_PLAUSIBLE_KMH) return;
        }
        const route = [...state.route, point];
        const totalDistanceKm = LocationService.routeDistanceKm(route);
        // Accumulate the newly-driven distance into this week's challenge totals.
        const deltaKm = Math.max(0, totalDistanceKm - state.totalDistanceKm);
        const rate = useProfileStore.getState().baseRate;
        // Same distance also advances the vehicle's service odometer.
        useProfileStore.getState().addMaintenanceKm(deltaKm);
        set({
          currentLocation: point,
          route,
          totalDistanceKm,
          weekDistanceKm: state.weekDistanceKm + deltaKm,
          weekEarnings: state.weekEarnings + deltaKm * rate,
        });
        syncLocation(point, totalDistanceKm);
      },
      setCurrentLocation: (point) => set({ currentLocation: point }),
      tickElapsed: () => {
        if (!get().isTracking || !trackingStartedAt) return;
        const elapsedMinutes = Math.floor((Date.now() - trackingStartedAt) / 60000);
        set({ elapsedMinutes });
      },
      resetRoute: () => {
        stopWatching?.();
        stopWatching = null;
        trackingStartedAt = null;
        set({
          route: [],
          totalDistanceKm: 0,
          elapsedMinutes: 0,
          currentLocation: initialPoint,
          isTracking: false,
        });
      },
      // Zero out "today's" distance / time / route when the calendar day rolls over,
      // so daily stats truly reset at midnight (and a brand-new day starts clean).
      // Weekly challenge totals reset the same way when the week rolls over.
      ensureToday: () => {
        if (get().isTracking) return;
        const today = todayKey();
        if (get().activeDate !== today) {
          set({ activeDate: today, route: [], totalDistanceKm: 0, elapsedMinutes: 0 });
        }
        const week = weekKey();
        if (get().activeWeek !== week) {
          set({ activeWeek: week, weekDistanceKm: 0, weekEarnings: 0 });
        }
      },
    }),
    {
      name: "masaya_location_v2",
      partialize: (state) => ({
        currentLocation: state.currentLocation,
        route: state.route.slice(-200),
        isTracking: false,
        permission: state.permission,
        elapsedMinutes: state.elapsedMinutes,
        totalDistanceKm: state.totalDistanceKm,
        activeDate: state.activeDate,
        activeWeek: state.activeWeek,
        weekDistanceKm: state.weekDistanceKm,
        weekEarnings: state.weekEarnings,
      }),
    },
  ),
);

function syncLocation(point: LocationPoint, totalDistanceKm: number) {
  const user = useAuthStore.getState().user;
  const profile = useProfileStore.getState();
  if (!user) return;
  // Fire-and-forget: a dropped GPS sync must never crash the tracking loop.
  void SupabaseService.saveLocation(
    user,
    point,
    profile.activeApp,
    totalDistanceKm,
    totalDistanceKm * profile.baseRate,
    profile.shareStats,
  ).catch((error) => {
    console.warn("Could not sync location to cloud:", error);
  });
}
