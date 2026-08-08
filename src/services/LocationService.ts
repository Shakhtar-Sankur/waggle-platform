import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { MANILA_CENTER } from "../config/constants";
import type { LocationPoint } from "../types";
import { translate } from "../i18n";

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

  async watchPosition(onUpdate: (point: LocationPoint) => void): Promise<() => void> {
    if (Capacitor.isNativePlatform()) {
      const permission = await Geolocation.requestPermissions();
      if (permission.location === "denied") {
        throw new Error(translate("err_locationDenied"));
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

  routeDistanceKm(points: LocationPoint[]) {
    let total = 0;
    for (let i = 1; i < points.length; i += 1) {
      total += distanceKm(points[i - 1], points[i]);
    }
    return total;
  },

  /** Straight-line distance between two fixes, in kilometres. */
  betweenKm(a: LocationPoint, b: LocationPoint) {
    return distanceKm(a, b);
  },
};

function toPoint(lat: number, lng: number, accuracy?: number): LocationPoint {
  return { lat, lng, accuracy, timestamp: Date.now() };
}

function fallbackPoint(): LocationPoint {
  return { ...MANILA_CENTER, accuracy: 100, timestamp: Date.now() };
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
