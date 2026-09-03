import { registerPlugin } from "@capacitor/core";

/**
 * A location fix recorded by the Android foreground service.
 *
 * `timestamp` is when the platform OBSERVED the fix, not when JavaScript read
 * it. Those are the same thing while the app is on screen and very different
 * after twenty minutes in a pocket, and the tracking store judges speed from
 * the gap between timestamps — so a batch restamped with "now" would look like
 * a teleport and be discarded as a GPS glitch.
 */
export interface TripFix {
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
}

export interface TripTrackingPlugin {
  /** Starts the foreground service. The strings are what the driver reads in
   *  their notification shade, already translated by the app's own i18n. */
  start(options: { title: string; text: string }): Promise<void>;
  stop(): Promise<void>;
  /** Everything recorded since the last call, oldest first, and clears it. */
  drain(): Promise<{ fixes: TripFix[] }>;
  isRunning(): Promise<{ running: boolean }>;
}

/** Android only. On web this resolves to a stub whose calls reject, which is
 *  why every caller has a non-native path rather than a platform check alone. */
export const TripTracking = registerPlugin<TripTrackingPlugin>("TripTracking");
