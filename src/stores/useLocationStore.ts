import { create } from "zustand";
import { persist } from "zustand/middleware";
import { MANILA_CENTER } from "../config/constants";
import { LocationService, MAX_PLAUSIBLE_KMH, SESSION_GAP_MS } from "../services/LocationService";
import { SupabaseService } from "../services/SupabaseService";
import type { LocationPoint } from "../types";
import { useAuthStore } from "./useAuthStore";
import { useNotificationStore } from "./useNotificationStore";
import { useProfileStore } from "./useProfileStore";
import { TripTracking } from "../services/TripTracking";
import { currencySymbol } from "../utils/format";
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

/**
 * Beyond this, a "fix" names a neighbourhood rather than a position.
 *
 * A cell-tower fallback reports itself accurate to 1–3 km. Two such fixes can
 * sit 800 m apart with the phone face-down on a table, which clears the 15 m
 * gate comfortably and pays the driver for a kilometre they did not drive.
 * This matters more now than it used to: the Android foreground service also
 * listens to NETWORK_PROVIDER so a trip survives a tunnel or a basement car
 * park, and that provider is exactly the one that returns these.
 *
 * 100 m keeps genuine wifi and assisted-GPS fixes, which is most of what a
 * phone reports in a city, and drops the ones that are really a guess.
 */
const MAX_ACCURACY_M = 100;

/**
 * A step only counts as movement if it is bigger than the uncertainty that
 * produced it.
 *
 * Two fixes each honestly accurate to 40 m can be 60 m apart with nothing
 * having moved — that is what "accurate to 40 m" means. A fixed 15 m gate was
 * tuned for a clean GPS fix and is simply the wrong question to ask of a
 * coarser one, so the gate rises to meet the worse of the two readings.
 *
 * Fixes with no accuracy at all keep the old behaviour: 15 m, and nothing else
 * to go on.
 */
function movementGateKm(a?: number, b?: number): number {
  const worst = Math.max(a ?? 0, b ?? 0) / 1000;
  return Math.max(MIN_MOVE_KM, worst);
}
/* MAX_PLAUSIBLE_KMH now lives in LocationService, because the replay of a past
   day needs the same threshold and two copies would drift apart. */

let stopWatching: (() => void) | null = null;
let trackingStartedAt: number | null = null;

/**
 * Consecutive fixes thrown away for being too imprecise, and whether the driver
 * has been told.
 *
 * Dropping coarse fixes is right, and doing it silently is not. A phone with a
 * blocked receiver — an underground car park, a windscreen mount behind heated
 * glass, a failing GPS chip — produces nothing but coarse fixes, so the filter
 * discards every one and the distance sits at zero with the panel still saying
 * "Recording activity". That is the same silent failure this app already had
 * once today, wearing different clothes: the driver cannot act on a problem
 * nobody mentions.
 *
 * Twenty in a row is about forty seconds at the service's collection rate —
 * long enough not to fire on a single bad reading under a bridge.
 */
const COARSE_RUN_BEFORE_WARNING = 20;
let coarseRun = 0;
let coarseWarned = false;

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
          /* The rate and the currency symbol go with the watch, so the ongoing
             notification can say what the trip is worth. The service cannot
             read settings itself, and while the phone is locked the WebView is
             suspended — so anything the notification shows has to have been
             handed over before the screen went off. */
          const profile = useProfileStore.getState();
          stopWatching = await LocationService.watchPosition(
            (next) => {
              get().updatePosition(next);
              /* Re-sync the service with OUR total. The service applies the
                 same gates but not every one of them, so over a long locked
                 stretch the two can drift; this makes the app's figure the one
                 on the notification whenever the app is awake. */
              void TripTracking.sync?.({ distanceKm: get().totalDistanceKm }).catch(() => {});
            },
            {
              rate: profile.baseRate,
              currency: currencySymbol(),
              unit: "km",
            },
          );
          trackingStartedAt = Date.now();
          // A new trip earns a fresh warning. Whatever was blocking the signal
          // last time — a car park, a tunnel — is not necessarily true now.
          coarseRun = 0;
          coarseWarned = false;
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

        // A fix too vague to locate the driver is not evidence of anything, and
        // must be dropped BEFORE it becomes the anchor every later fix is
        // measured against — otherwise one cell-tower guess poisons the next
        // real reading too. Say so if it keeps happening: a driver whose
        // distance is frozen deserves to know their GPS is the reason.
        if (point.accuracy != null && point.accuracy > MAX_ACCURACY_M) {
          coarseRun += 1;
          if (coarseRun >= COARSE_RUN_BEFORE_WARNING && !coarseWarned) {
            coarseWarned = true;
            useNotificationStore
              .getState()
              .push(translate("notif_gpsWeak"), translate("notif_gpsWeakBody"), "location");
          }
          return;
        }
        coarseRun = 0;

        const last = state.route[state.route.length - 1];
        let movedKm = 0;
        if (last) {
          const moved = LocationService.betweenKm(last, point);
          // Earnings are paid per kilometre, so phantom distance is phantom
          // money. A phone sitting still still reports GPS fixes that wander by
          // 5–15 m, which previously accumulated all day while parked or at a
          // red light. Ignore anything below the noise floor — a floor that now
          // rises with how uncertain the two fixes admit they are…
          if (moved < movementGateKm(last.accuracy, point.accuracy)) return;
          // …and reject teleports (a lost then re-acquired fix), which would
          // otherwise credit a driver kilometres they never drove.
          const seconds = Math.max(1, (point.timestamp - last.timestamp) / 1000);
          if (moved / (seconds / 3600) > MAX_PLAUSIBLE_KMH) return;
          movedKm = moved;

          /* A silence longer than a session gap is not driving. Fixes arrive
             every couple of seconds, so this is the app having been shut, or
             GPS lost for a very long time; either way the straight line across
             it was not travelled. routeDistanceKm applies the same rule when
             replaying a past day, and the two must agree about one journey. */
          const ms = point.timestamp - last.timestamp;
          if (Number.isFinite(ms) && ms > SESSION_GAP_MS) movedKm = 0;
        }

        const route = [...state.route, point];
        /* Add the step rather than re-measuring the whole route.
           routeDistanceKm re-walked every fix on every fix, which is O(n²) over
           a shift — around a hundred million distance calculations across a
           long day, on a phone that is also holding a GPS lock. The arriving
           step has already passed the same filters that function applies, so
           the running total it would produce is the one accumulated here. */
        const totalDistanceKm = state.totalDistanceKm + movedKm;
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
