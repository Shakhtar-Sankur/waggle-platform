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
  hydrateFromServer: () => Promise<void>;
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
  /* The SUM of the two uncertainties, not the larger of them.
   *
   * The paragraph above has it right — "two fixes each honestly accurate to
   * 40 m can be 60 m apart with nothing having moved" — and then the code took
   * the max, which is 40. That gap is where parked drift got in. Measured: a
   * stationary handset reporting accuracy 12 and wandering ±10 m booked 0.18 km
   * over sixty fixes, because a max-gate of 15 m passes every wander bigger
   * than 15 m and each one is committed as forward travel. A random walk
   * filtered by a minimum step still accumulates; only the big steps survive
   * and every survivor counts as positive distance.
   *
   * Adding them asks the question that actually matters: could these two
   * readings be the same place? Two fixes at 12 m become a 24 m gate, which the
   * drift no longer clears, while a driver moving at any real speed clears it
   * in a single fix. */
  const combined = ((a ?? 0) + (b ?? 0)) / 1000;
  return Math.max(MIN_MOVE_KM, combined);
}

/**
 * Below this the handset is telling us it is not travelling.
 *
 * Where the device reports speed it is far better evidence than comparing two
 * positions, because it comes from Doppler rather than from subtracting two
 * uncertain numbers. 1 m/s is a slow walk; a driver stopped at a light or
 * waiting at a stand sits well under it. Absent or negative means the device
 * does not know, and then position is all we have.
 */
const STATIONARY_MS = 1;
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

/**
 * Every fix that passed the accuracy and plausibility checks in the last few
 * minutes — including the ones too small to count as movement.
 *
 * Two checks below need recent raw history rather than the last COUNTED point.
 * Measured on an 18.8 km Mumbai route replayed through this store:
 *
 *  - Plausibility was judged against the last counted point, which can be many
 *    seconds old because the movement gate rejects most fixes at city speeds. A
 *    300 m multipath jump claiming 15 m accuracy then looked like 180 km/h over
 *    six seconds instead of 540 km/h over two, and passed — twice, out and back.
 *    +5.4% on the trip.
 *  - A parked phone that reports no speed drifted past the movement gate often
 *    enough to book 0.5 km in twenty minutes (₹16 an hour at ₹10/km).
 */
let recentFixes: LocationPoint[] = [];
const RECENT_WINDOW_MS = 3 * 60 * 1000;

/** How far back to look for the "has the driver actually gone anywhere" test. */
const PROGRESS_WINDOW_MS = 60 * 1000;

/**
 * Below this net speed across the last minute, the fixes are wandering, not
 * travelling. 2 km/h is under a slow walk; a rider crawling in a jam at 3-4 km/h
 * still clears it, while GPS drift around a parked phone nets close to zero
 * however much it zigzags.
 */
const MIN_PROGRESS_KMH = 2;

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

          /* Refuse to start on a guess.
           *
           * currentPosition resolves a FALLBACK point when the browser refuses
           * or times out rather than rejecting — which is right for the callers
           * that only need somewhere to centre a map, and wrong here. It meant
           * the catch below never ran on a denial, so tapping Start with
           * location switched off flipped the panel to "Recording activity ·
           * LIVE" and left it there: no error, no warning, and 0.00 km for as
           * long as the driver cared to look. Someone could drive an entire
           * shift believing it was being recorded.
           *
           * The point already carries the flag that says it is a guess, and its
           * own comment says callers that measure FROM it need to know. This is
           * one of those callers. */
          if (point.fallback) throw new Error(translate("err_locationDenied"));

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
            /* Revoked mid-trip. Stop rather than keep a LIVE panel over a
               number that can no longer move, and say why. */
            () => {
              get().stopTracking();
              set({ permission: "denied" });
              useNotificationStore
                .getState()
                .push(translate("err_locationDenied"), translate("notif_sessionEndedBody"), "location");
            },
          );
          trackingStartedAt = Date.now();
          // A new trip earns a fresh warning. Whatever was blocking the signal
          // last time — a car park, a tunnel — is not necessarily true now.
          coarseRun = 0;
          coarseWarned = false;
          recentFixes = [];
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

        /* Plausibility against the previous RAW fix, seconds ago — not against the
           last counted point, which may be much older. A jump that is impossible
           over two seconds is a bad fix even if it would be possible over six. A
           long silence is left to the session-gap rule further down. */
        const prevRaw = recentFixes[recentFixes.length - 1];
        if (prevRaw) {
          const gapMs = point.timestamp - prevRaw.timestamp;
          if (gapMs >= 0 && gapMs < SESSION_GAP_MS) {
            const hours = Math.max(1, gapMs / 1000) / 3600;
            if (LocationService.betweenKm(prevRaw, point) / hours > MAX_PLAUSIBLE_KMH) return;
          }
        }
        recentFixes.push(point);
        while (recentFixes.length && point.timestamp - recentFixes[0].timestamp > RECENT_WINDOW_MS) recentFixes.shift();
        if (recentFixes.length > 400) recentFixes = recentFixes.slice(-400);

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
          /* And if the handset says it is standing still, believe it. Two
             positions can disagree by more than the gate through nothing but
             noise; a speed reading cannot drift a driver into motion. */
          if (typeof point.speed === "number" && point.speed >= 0 && point.speed < STATIONARY_MS) return;
          /* No speed reading to trust: ask whether the driver has actually got
             anywhere over the last minute. Drift clears the step gate now and
             then, but it wanders around one spot, so its net progress is tiny. */
          const hasSpeed = typeof point.speed === "number" && point.speed >= 0;
          if (!hasSpeed) {
            let ref: LocationPoint | undefined;
            for (let i = recentFixes.length - 1; i >= 0; i--) {
              if (point.timestamp - recentFixes[i].timestamp >= PROGRESS_WINDOW_MS) { ref = recentFixes[i]; break; }
            }
            if (ref) {
              const hours = (point.timestamp - ref.timestamp) / 3_600_000;
              const netKm = LocationService.betweenKm(ref, point);
              /* And the minute's progress must also beat three times what the
                 fixes admit they could be wrong by. Drift wanders inside that
                 circle; a 3.5 km/h crawl covers ~58 m a minute and clears it. */
              const uncertaintyKm = (3 * Math.max(ref.accuracy ?? 5, point.accuracy ?? 5)) / 1000;
              if (netKm / hours < MIN_PROGRESS_KMH || netKm < uncertaintyKm) return;
            }
          }
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
        recentFixes = [];
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
      /**
       * Load today's distance back from the server.
       *
       * The daily total lived only in this store, which persists to
       * localStorage. Everything needed to rebuild it has been written to
       * route_points since the beginning — the same rows the map and the seven
       * day history read — but nothing ever read it back for this number. So a
       * driver who cleared their browser, reinstalled, or signed in on a second
       * phone saw 0.0 km and zero earnings for a day they had actually worked.
       * The distance was never lost; the screen simply never asked.
       *
       * Takes the LARGER of the two rather than overwriting. A fix that has been
       * recorded locally but not yet posted is real distance the server does not
       * know about, and a driver mid-shift must never watch their total drop
       * because a sync landed. ensureToday() has already zeroed a stale local
       * figure by the time this runs, so "larger" cannot resurrect yesterday.
       */
      hydrateFromServer: async () => {
        if (!useAuthStore.getState().user) return;

        const days = await SupabaseService.routeHistory(7).catch(() => []);
        if (!days.length) return;

        /* routeHistory pads its keys ("2026-09-10") while todayKey() does not
           ("2026-9-10"), because the latter is only ever compared against
           itself as a persistence marker. Matching on todayKey() here would
           never find a row and this whole function would quietly do nothing —
           the worst kind of fix, one that looks applied. Formatted to match the
           service rather than changing todayKey(), which would invalidate the
           activeDate already persisted on every installed device. */
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        const server = days.find((entry) => entry.day === today)?.km ?? 0;
        const week = days.reduce((sum, entry) => sum + entry.km, 0);

        const state = get();
        // Tracking owns the counter while it runs; stepping on it mid-drive
        // would fight the live updates coming from each new fix.
        if (state.isTracking) return;

        const rate = useProfileStore.getState().baseRate;
        set({
          totalDistanceKm: Math.max(state.totalDistanceKm, server),
          weekDistanceKm: Math.max(state.weekDistanceKm, week),
          weekEarnings: Math.max(state.weekEarnings, week * rate),
        });
      },

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
