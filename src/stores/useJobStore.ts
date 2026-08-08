import { create } from "zustand";
import { persist } from "zustand/middleware";
import { JobService } from "../services/JobService";
import { SupabaseService } from "../services/SupabaseService";
import type { Job } from "../types";
import { useAuthStore } from "./useAuthStore";
import { useNotificationStore } from "./useNotificationStore";
import { translate } from "../i18n";

interface JobState {
  jobs: Job[];
  loadCloudJobs: (userId: string) => Promise<void>;
  createJob: (job: Omit<Job, "id" | "status">) => void;
  addLiveJob: () => void;
  acceptJob: (id: string) => void;
  declineJob: (id: string) => void;
  completeJob: (id: string) => void;
}

export const useJobStore = create<JobState>()(
  persist(
    (set) => ({
      jobs: JobService.list(),
      loadCloudJobs: async (userId) => {
        try {
          const jobs = await SupabaseService.loadJobs(userId);
          if (jobs.length) set({ jobs });
        } catch (error) {
          // Fall back to the locally-seeded/persisted job list.
          console.warn("Could not load cloud jobs:", error);
        }
      },
      createJob: (job) => {
        set((state) => ({
          jobs: [{ ...job, id: crypto.randomUUID(), status: "open" }, ...state.jobs],
        }));
      },
      addLiveJob: () => {
        const job = JobService.generateLiveJob();
        set((state) => ({ jobs: [job, ...state.jobs] }));
        useNotificationStore
          .getState()
          .push(translate("notif_jobAlert"), `${job.title} • ${job.pickup} → ${job.dropoff}`, "job");
      },
      acceptJob: (id) => {
        set((state) => ({
          jobs: state.jobs.map((job) => (job.id === id ? { ...job, status: "accepted" } : job)),
        }));
        syncStatus(id, "accepted");
        useNotificationStore.getState().push(translate("notif_jobAccepted"), translate("notif_jobAcceptedBody"), "job");
      },
      declineJob: (id) => {
        set((state) => ({
          jobs: state.jobs.map((job) => (job.id === id ? { ...job, status: "declined" } : job)),
        }));
        syncStatus(id, "declined");
      },
      completeJob: (id) => {
        set((state) => ({
          jobs: state.jobs.map((job) => (job.id === id ? { ...job, status: "completed" } : job)),
        }));
        syncStatus(id, "completed");
        useNotificationStore.getState().push(translate("notif_jobCompleted"), translate("notif_jobCompletedBody"), "job");
      },
    }),
    { name: "masaya_jobs_v3" },
  ),
);

function syncStatus(id: string, status: Job["status"]) {
  const user = useAuthStore.getState().user;
  if (!user) return;
  void SupabaseService.updateJobStatus(id, status, user.id).catch((error) => {
    console.warn("Could not sync job status to cloud:", error);
  });
}
