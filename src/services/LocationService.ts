import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { defaultCenterFor } from "../config/geo";
import { resolveCountryForLocation } from "../i18n/region";
import type { LocationPoint } from "../types";
import { translate } from "../i18n";
import { TripTracking } from "./TripTracking";

/**
 * Above this, a pair of fixes is not travel — it is a GPS glitch, or the join
 * between two separate recording sessions.
 *
 * Defined here rather than in the tracking store because both need it and the
 * store already imports this module; two copies of a threshold like this drift
 * apart, and then the live path and the replayed path disagree about the same
 * journey.
 */
export const MAX_PLAUSIBLE_KMH = 200;

/**
 * Silence longer than this between two fixes means the app was not running.
 *
 * Tracking writes a fix every few seconds, so any real gap is small; five
 * minutes is generous enough to survive a long tunnel and short enough to catch
 * the driver who stopped at lunchtime and started again in the evening.
 */
export const SESSION_GAP_MS = 5 * 60 * 1000;

export const LocationService = {
  async currentPosition(): Promise<LocationPoint> {
    if (Capacitor.isNativePlatform()) {
      try {
        const permission = await Geolocation.requestPermissions();
        if (permission.location !== "denied") {
          const position = await Geolocation.getCurrentPosition({
            enableHighAccuracy: true,
            timeout: 8000,
          });
          return toPoint(position.coords.latitude, position.coords.longitude, position.coords.accuracy);
        }
      } catch {
        return fallbackPoint();
      }
    }

    if (!("geolocation" in navigator)) {
      return fallbackPoint();
    }

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve(toPoint(position.coords.latitude, position.coords.longitude, position.coords.accuracy));
        },
        () => resolve(fallbackPoint()),
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 15000 },
      );
    });
  },

  /**
   * @param trip  Rate, currency symbol and distance unit for the ongoing
   *   notification. Optional because the web build has no notification, and a
   *   caller that does not care should not have to pass anything.
   */
  async watchPosition(
    onUpdate: (point: LocationPoint) => void,
    trip: { rate?: number; currency?: string; unit?: string } = {},
  ): Promise<() => void> {
    if (Capacitor.isNativePlatform()) {
      const permission = await Geolocation.requestPermissions();
      if (permission.location === "denied") {
        throw new Error(translate("err_locationDenied"));
      }

      /* Hand the trip to a foreground service rather than watching from here.
         An in-process watch stops the moment the screen goes off — Android 10+
         cuts location to any app with no visible activity and no location
         service — so the driver who pockets their phone and drives for four
         hours used to come back to the distance they had when it locked, with
         the panel still reading "Recording activity". The service keeps
         collecting and buffering; this side drains it. See TripTrackingService. */
      try {
        await TripTracking.start({
          title: translate("track_notifTitle"),
          text: translate("track_notifBody"),
          ...trip,
        });
        return drainFromService(onUpdate);
      } catch {
        /* The service would not start. Rather than tell the driver nothing and
           record nothing, fall through to the in-process watch below: it is
           worse — it stops at the lock screen — but it is not silence, and the
           screen-on case still works. */
      }

      const watchId = await Geolocation.watchPosition(
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0,
        },
        (position, error) => {
          if (error || !position) return;
          onUpdate(toPoint(position.coords.latitude, position.coords.longitude, position.coords.accuracy));
        },
      );
      return () => {
        void Geolocation.clearWatch({ id: watchId }).catch(() => undefined);
      };
    }

    if (!("geolocation" in navigator)) {
      throw new Error(translate("err_geolocationUnavailable"));
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        onUpdate(toPoint(position.coords.latitude, position.coords.longitude, position.coords.accuracy));
      },
      () => undefined,
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  },

  /**
   * Distance along a trace, skipping the joins between separate sessions.
   *
   * This used to add every consecutive pair. That is correct for a live route,
   * where each fix has already been filtered as it arrived, and wrong for a day
   * read back out of route_points — a day holds every session the driver
   * recorded, and summing it end to end draws a straight line from wherever
   * they stopped to wherever they next pressed Start.
   *
   * Measured on one real day in the database: 57.53 km naive, of which 9.56 km
   * was four such joins, the largest a 7.42 km line across a 3.5 hour gap. The
   * driver did not travel it, and since earnings are distance x rate, that is
   * not a cosmetic error.
   *
   * TWO rules, because one is not enough. Speed alone — the test the live
   * tracker uses on arriving fixes — misses these entirely: 7.42 km across 3.5
   * hours is 2 km/h, which is a perfectly plausible speed, so the filter passed
   * it and the total stayed at 57.53 km. What actually marks a join is the GAP.
   * Tracking writes a fix every few seconds, so a silence longer than
   * SESSION_GAP_MS means the app was shut, not that the driver crawled.
   *
   * So: a segment is skipped if it spans more than SESSION_GAP_MS, or if it
   * implies more than MAX_PLAUSIBLE_KMH (a GPS glitch inside one session).
   * Both are no-ops on a live route, whose fixes are seconds apart and already
   * filtered. A pair with no usable timestamps is counted — there is nothing to
   * judge it by.
   */
  routeDistanceKm(points: LocationPoint[]) {
    let total = 0;
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      const km = distanceKm(a, b);
      const ms = b.timestamp - a.timestamp;
      if (Number.isFinite(ms) && ms > 0) {
        if (ms > SESSION_GAP_MS) continue;                              // separate sessions
        if (km / (ms / 3600000) > MAX_PLAUSIBLE_KMH) continue;          // glitch
      }
      total += km;
    }
    return total;
  },

  /** Straight-line distance between two fixes, in kilometres. */
  betweenKm(a: LocationPoint, b: LocationPoint) {
    return distanceKm(a, b);
  },
};

function toPoint(lat: number, lng: number, accuracy?: number, timestamp?: number): LocationPoint {
  // `timestamp` is optional because a live fix arrives as it happens, so "now"
  // is the truth. A fix replayed out of the service buffer is NOT now — it may
  // be an hour old — and must carry the time it was observed. See TripFix.
  return { lat, lng, accuracy, timestamp: timestamp ?? Date.now() };
}

/**
 * How often to collect what the foreground service has recorded.
 *
 * Only meaningful while the app is on screen: a backgrounded WebView has its
 * timers throttled to nothing, which is exactly why the service buffers instead
 * of pushing. Two seconds keeps the on-screen distance honest while the driver
 * is looking at it, and costs one bridge call.
 */
const DRAIN_INTERVAL_MS = 2000;

/**
 * Feed the store from the foreground service's buffer.
 *
 * Polling rather than an event per fix, deliberately. A live event and a
 * buffered copy of the same fix are impossible to reconcile — the fix is
 * counted, then drained and counted again — and since earnings are distance
 * times rate, double-counting is not a cosmetic bug. One path in, one answer.
 *
 * The visibility listener is what makes the pocket case work: while the phone
 * is locked nothing here runs, the service quietly fills its buffer, and the
 * first thing that happens on unlock is a drain of everything missed, each fix
 * still carrying the time it was recorded.
 */
function drainFromService(onUpdate: (point: LocationPoint) => void): () => void {
  let stopped = false;

  const drain = async () => {
    if (stopped) return;
    try {
      const { fixes } = await TripTracking.drain();
      for (const fix of fixes) {
        onUpdate(toPoint(fix.lat, fix.lng, fix.accuracy, fix.timestamp));
      }
    } catch {
      /* The bridge is asleep or the service is gone. The buffer is not cleared
         on a failed drain, so nothing is lost — the next one collects it. */
    }
  };

  const timer = window.setInterval(() => void drain(), DRAIN_INTERVAL_MS);
  const onVisibility = () => {
    if (document.visibilityState === "visible") void drain();
  };
  document.addEventListener("visibilitychange", onVisibility);
  void drain();

  return () => {
    stopped = true;
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisibility);
    void TripTracking.stop().catch(() => undefined);
  };
}

function fallbackPoint(): LocationPoint {
  // Every unknown position used to be Manila, which is right for one country
  // and wrong for the rest — a driver in Lagos who declines the location
  // prompt opened the map on another continent.
  //
  // Timezone first, locale second. They disagree more than you would expect:
  // a driver in Mumbai on an English handset reports en-US with
  // Asia/Calcutta, and trusting the locale drops the map in New York. The
  // timezone follows the phone; the locale follows the reader.
  //
  // Still flagged, because it is still a guess and some callers must know that.
  const country = resolveCountryForLocation();
  return { ...defaultCenterFor(country), accuracy: 100, timestamp: Date.now(), fallback: true };
}

function distanceKm(a: LocationPoint, b: LocationPoint) {
  const radius = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(h));
}

function toRad(value: number) {
  return (value * Math.PI) / 180;
}
