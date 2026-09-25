import { create } from "zustand";
import { persist } from "zustand/middleware";
import { LocationService } from "../services/LocationService";
import { SupabaseService } from "../services/SupabaseService";
import type { Job } from "../types";
import { useAuthStore } from "./useAuthStore";
import { useNotificationStore } from "./useNotificationStore";
import { translate } from "../i18n";

/** How far a worker is offered work. City riding; beyond this the trip out costs more than the job pays. */
export const JOB_RADIUS_KM = 12;

/**
 * Waggle's delivery charge, the same formula the database uses in post_job():
 * Rs 25 for the first two kilometres, then Rs 9 a kilometre. All of it is the
 * worker's.
 */
export function suggestedFare(distanceKm: number): number {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return 0;
  return Math.round(25 + Math.max(0, distanceKm - 2) * 9);
}

export type StepAnswer = "ok" | "wrong" | "locked" | "not_yours" | "too_late" | "no_code" | "offline" | "error";

interface JobState {
  /** Real jobs only: open ones near the worker, and the ones they hold or finished. */
  jobs: Job[];
  /** Offers this worker swiped away. Nothing is written; the job stays open for others. */
  dismissed: string[];
  loadCloudJobs: (userId: string, withOffers?: boolean) => Promise<void>;
  acceptJob: (id: string) => Promise<void>;
  declineJob: (id: string) => void;
  confirmPickup: (id: string, code: string) => Promise<StepAnswer>;
  confirmDelivery: (id: string, code: string) => Promise<StepAnswer>;
  releaseJob: (id: string) => Promise<StepAnswer>;
  reportUnpaid: (id: string) => Promise<StepAnswer>;
}

export const useJobStore = create<JobState>()(
  persist(
    (set, get) => ({
      jobs: [],
      dismissed: [],
      loadCloudJobs: async (userId, withOffers = true) => {
        try {
          /* Near first: a worker is only offered pickups they could reach, and
             only if Gigzen has verified them (the database decides that). Offline,
             only their own jobs: no GPS fix for offers they would not be shown. */
          let offers: Job[] = [];
          if (withOffers) {
            try {
              const here = await LocationService.currentPosition();
              offers = await SupabaseService.loadNearbyJobs(here.lat, here.lng, JOB_RADIUS_KM);
            } catch (error) {
              console.warn("Could not load jobs near the worker:", error);
            }
          }
          const mine = await SupabaseService.loadMyJobs(userId);
          const seen = new Set<string>();
          const jobs = [...mine, ...offers].filter((job) => (seen.has(job.id) ? false : (seen.add(job.id), true)));
          // Always replace: a job that is gone from the server must go from the screen.
          set((state) => ({ jobs, dismissed: state.dismissed.filter((id) => jobs.some((j) => j.id === id)) }));
        } catch (error) {
          console.warn("Could not load cloud jobs:", error);
        }
      },
      acceptJob: async (id) => {
        /* First accept wins, and the database decides. Two workers can press
           Accept in the same second; accept_job() claims the row only while it
           is still open, so the loser is told the job is gone. */
        if (!SupabaseService.enabled || !useAuthStore.getState().user) return;
        try {
          const claimed = await SupabaseService.acceptJob(id);
          if (!claimed) {
            set((state) => ({ jobs: state.jobs.filter((job) => job.id !== id) }));
            useNotificationStore.getState().push(translate("job_takenTitle"), translate("job_takenBody"), "job");
            return;
          }
          set((state) => ({ jobs: state.jobs.map((job) => (job.id === id ? claimed : job)) }));
          useNotificationStore.getState().push(translate("notif_jobAccepted"), translate("notif_jobAcceptedBody"), "job");
        } catch (error) {
          useNotificationStore.getState().push(translate("job_errTitle"), error instanceof Error ? error.message : "", "job");
        }
      },
      declineJob: (id) => set((state) => ({ dismissed: [...state.dismissed, id] })),
      confirmPickup: async (id, code) => step(id, () => SupabaseService.confirmPickup(id, code), get, set),
      confirmDelivery: async (id, code) => {
        const answer = await step(id, () => SupabaseService.confirmDelivery(id, code), get, set);
        if (answer === "ok") {
          useNotificationStore.getState().push(translate("notif_jobCompleted"), translate("notif_jobCompletedBody"), "job");
        }
        return answer;
      },
      releaseJob: async (id) => step(id, () => SupabaseService.releaseJob(id), get, set),
      reportUnpaid: async (id) => step(id, () => SupabaseService.reportUnpaid(id), get, set),
    }),
    // v4: earlier versions could keep jobs the server no longer had.
    { name: "waggle_jobs_v4", partialize: (state) => ({ jobs: state.jobs, dismissed: state.dismissed }) },
  ),
);

async function step(
  id: string,
  run: () => Promise<string>,
  get: () => JobState,
  set: (partial: Partial<JobState>) => void,
): Promise<StepAnswer> {
  void id;
  try {
    const answer = (await run()) as StepAnswer;
    const user = useAuthStore.getState().user;
    if (answer === "ok" && user) await get().loadCloudJobs(user.id);
    else if (answer === "not_yours") set({ jobs: get().jobs.filter((job) => job.id !== id) });
    return answer;
  } catch (error) {
    console.warn("Job step failed:", error);
    return "error";
  }
}
