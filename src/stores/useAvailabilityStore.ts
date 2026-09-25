import { create } from "zustand";
import { persist } from "zustand/middleware";
import { LocationService } from "../services/LocationService";
import { SupabaseService } from "../services/SupabaseService";
import { useAuthStore } from "./useAuthStore";
import { useJobStore } from "./useJobStore";
import { useLocationStore } from "./useLocationStore";
import { useNotificationStore } from "./useNotificationStore";
import { translate } from "../i18n";

/** How often an online worker's position is refreshed while the app is open. */
const REFRESH_MS = 2 * 60 * 1000;

interface AvailabilityState {
  online: boolean;
  busy: boolean;
  goOnline: () => Promise<void>;
  goOffline: () => Promise<void>;
  /** Re-send the position while online; the server treats a stale row as offline. */
  refresh: () => Promise<void>;
}

/**
 * Online means "offer me Waggle work", and it switches the GPS on with it.
 *
 * There used to be a separate Start Tracking switch for work on other apps, and
 * the rider's live position only reached the customer's tracking map if they
 * had also pressed that. Waggle Gig is a Waggle rider app now: one switch, and
 * the position follows it.
 */
export const useAvailabilityStore = create<AvailabilityState>()(
  persist(
    (set, get) => ({
      online: false,
      busy: false,
      goOnline: async () => {
        if (get().busy) return;
        set({ busy: true });
        try {
          const here = await LocationService.currentPosition();
          // A guessed position (location off or refused) would put the rider in
          // the wrong city for dispatch. No real fix, no going online.
          if (here.fallback) {
            useNotificationStore.getState().push(translate("err_locationDenied"), translate("gg_needLocation"), "location");
            return;
          }
          const user = useAuthStore.getState().user;
          if (user) await SupabaseService.setAvailability(user.id, true, here.lat, here.lng);
          set({ online: true });
          if (user) void useJobStore.getState().loadCloudJobs(user.id);
          // Online is GPS on: dispatch needs to know where the rider is, and the
          // customer's map follows them once they carry an order.
          if (!useLocationStore.getState().isTracking) void useLocationStore.getState().startTracking();
        } catch (error) {
          console.warn("Could not go online:", error);
        } finally {
          set({ busy: false });
        }
      },
      goOffline: async () => {
        if (get().busy) return;
        set({ busy: true, online: false });
        if (useLocationStore.getState().isTracking) useLocationStore.getState().stopTracking();
        try {
          const user = useAuthStore.getState().user;
          if (user) await SupabaseService.setAvailability(user.id, false);
        } catch (error) {
          console.warn("Could not go offline:", error);
        } finally {
          set({ busy: false });
        }
      },
      refresh: async () => {
        if (!get().online) return;
        const user = useAuthStore.getState().user;
        if (!user) return;
        try {
          const here = await LocationService.currentPosition();
          // A guess would move the rider to the fallback city; keep the last real position instead.
          if (here.fallback) return;
          await SupabaseService.setAvailability(user.id, true, here.lat, here.lng);
        } catch (error) {
          console.warn("Could not refresh availability:", error);
        }
      },
    }),
    // Only the switch itself survives a restart; `busy` never should.
    { name: "waggle_online_v1", partialize: (state) => ({ online: state.online }) },
  ),
);

export const AVAILABILITY_REFRESH_MS = REFRESH_MS;
