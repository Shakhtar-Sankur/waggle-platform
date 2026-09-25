import { create } from "zustand";
import { SupabaseService, type VerificationForm, type WorkerVerification } from "../services/SupabaseService";

/**
 * Whether Gigzen has verified this worker. Only verified workers are offered
 * Waggle jobs; the database enforces it, this store lets the app say why.
 */
interface VerificationState {
  /** undefined while loading; null when the worker has never applied. */
  verification: WorkerVerification | null | undefined;
  load: (userId: string) => Promise<void>;
  submit: (userId: string, form: VerificationForm, idPhoto: Blob, selfie: Blob, licencePhoto?: Blob, rcPhoto?: Blob) => Promise<void>;
}

export const useVerificationStore = create<VerificationState>()((set) => ({
  verification: undefined,
  load: async (userId) => {
    try {
      set({ verification: await SupabaseService.myVerification(userId) });
    } catch {
      set({ verification: null });
    }
  },
  submit: async (userId, form, idPhoto, selfie, licencePhoto, rcPhoto) => {
    await SupabaseService.submitVerification(userId, form, idPhoto, selfie, licencePhoto, rcPhoto);
    set({ verification: await SupabaseService.myVerification(userId) });
  },
}));
