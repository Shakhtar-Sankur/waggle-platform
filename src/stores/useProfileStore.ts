import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ProfileSettings, VehicleType, WorkAppId } from "../types";
import { SupabaseService } from "../services/SupabaseService";
import { defaultDailyGoalFor, defaultRateFor, setCurrency } from "../utils/format";
import { useAuthStore } from "./useAuthStore";
import { useNotificationStore } from "./useNotificationStore";
import { translate } from "../i18n";

interface ProfileState extends ProfileSettings {
  /** True once the driver has set their own per-km rate, so auto-detected
   *  currency changes stop overwriting it. Local only — never sent to cloud
   *  (saveSettings whitelists its columns). */
  rateCustomised: boolean;
  /** The same protection for the daily goal, tracked separately.
   *
   *  One flag for both was a data-loss bug: it is only set when the RATE is
   *  edited, but the goal is the field a driver actually changes ("I want to
   *  make ₹1,500 today"). Editing only the goal left the flag false, so the
   *  first real GPS fix on the map screen called applyCurrency and reset their
   *  ₹1,500 target to the regional default of ₹600 — silently, on a screen they
   *  were not looking at. A goal the driver chose is theirs. */
  goalCustomised: boolean;
  loadCloudSettings: (userId: string) => Promise<void>;
  setActiveApp: (app: WorkAppId | null) => void;
  updateSettings: (updates: Partial<ProfileSettings>) => void;
  applyCurrency: (code: string) => void;
  addMaintenanceKm: (km: number) => void;
  logMaintenance: () => void;
}

const defaults: ProfileSettings = {
  activeApp: null,
  homeAddress: "",
  baseRate: 10,
  dailyGoal: 500,
  vehicleType: "car",
  maintenanceKm: 0,
  shareStats: true,
  currencyCode: "PHP",
};

export const useProfileStore = create<ProfileState>()(
  persist(
    (set, get) => ({
      ...defaults,
      rateCustomised: false,
      goalCustomised: false,
      loadCloudSettings: async (userId) => {
        try {
          const settings = await SupabaseService.loadSettings(userId);
          if (settings) {
            set(settings);
            /* A stored rate and goal are the driver's own, so auto-currency must
               not overwrite them.
               Without this the two fought each other every session: the cloud
               profile loads daily_goal 1500, then the first GPS fix on the map
               calls applyCurrency, which resets it to the ₹600 regional default
               on a screen the driver is not looking at. Going back to the home
               screen showed a target they never chose — and because
               persistSettings writes whatever is in state, the next settings
               change would have written 600 over their 1500 for good. */
            if (settings.baseRate !== undefined) set({ rateCustomised: true });
            if (settings.dailyGoal !== undefined) set({ goalCustomised: true });
          }
        } catch (error) {
          // Keep locally-persisted settings when the cloud is unreachable.
          console.warn("Could not load cloud settings:", error);
        }
      },
      setActiveApp: (app) => {
        set({ activeApp: app });
        persistSettings(get());
        if (app) {
          useNotificationStore
            .getState()
            .push(translate("notif_workAppUpdated"), translate("notif_workAppUpdatedBody"), "system");
        }
      },
      updateSettings: (updates) => {
        const wasSharing = get().shareStats;
        set(updates);
        // Once they choose a rate or a goal, auto-currency must never overwrite
        // it. Tracked separately: editing one must not silently surrender the
        // other to the regional default.
        if (updates.baseRate !== undefined) set({ rateCustomised: true });
        if (updates.dailyGoal !== undefined) set({ goalCustomised: true });
        if (updates.currencyCode) setCurrency(updates.currencyCode);
        persistSettings(get());
        // Opting out of community sharing must take effect immediately, not on
        // the next GPS tick — pull the driver off the shared map right away.
        if (wasSharing && updates.shareStats === false) {
          const user = useAuthStore.getState().user;
          if (user) {
            void SupabaseService.stopSharingLocation(user.id).catch((error) => {
              console.warn("Could not stop sharing location:", error);
            });
          }
        }
        useNotificationStore.getState().push(translate("notif_profileUpdated"), translate("notif_profileUpdatedBody"), "system");
      },
      // Auto-applied currency from location detection — local only, no toast, no cloud write.
      applyCurrency: (code) => {
        // Move the starting per-km rate AND the daily goal to something sane for
        // this currency, unless the driver has already set their own. "10" is
        // right for ₱10/km but absurd as $10/km, and a flat 500/day goal needs
        // 714 km at $0.70/km — unreachable, so the ring would never move.
        if (!get().rateCustomised) set({ baseRate: defaultRateFor(code) });
        if (!get().goalCustomised) set({ dailyGoal: defaultDailyGoalFor(code) });
        if (get().currencyCode === code) {
          setCurrency(code);
          return;
        }
        set({ currencyCode: code });
        setCurrency(code);
      },
      // Odometer since the last service, fed by GPS tracking. Local-only and
      // silent (no toast/cloud write) — it ticks on every position update.
      addMaintenanceKm: (km) => {
        if (!(km > 0)) return;
        set((state) => ({ maintenanceKm: state.maintenanceKm + km }));
      },
      logMaintenance: () => {
        set({ maintenanceKm: 0 });
        persistSettings(get());
        useNotificationStore
          .getState()
          .push(translate("notif_maintenanceRecorded"), translate("notif_maintenanceRecordedBody"), "system");
      },
    }),
    {
      name: "masaya_profile_v2",
      onRehydrateStorage: () => (state) => {
        if (state?.currencyCode) setCurrency(state.currencyCode);
      },
    },
  ),
);

function persistSettings(settings: ProfileSettings) {
  const user = useAuthStore.getState().user;
  if (!user) return;
  // Fire-and-forget: local state is already updated, so a failed cloud save
  // must not surface an unhandled rejection.
  void SupabaseService.saveSettings(user.id, settings).catch((error) => {
    console.warn("Could not save settings to cloud:", error);
  });
}

export const vehicleLabels: Record<VehicleType, string> = {
  car: "Car",
  motorcycle: "Motorcycle",
  bicycle: "Bicycle",
};
