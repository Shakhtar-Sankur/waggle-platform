import { create } from "zustand";

// Same key the gate has always used, read directly rather than through the
// persist middleware — an already-consented driver must not be asked again
// because the storage shape changed underneath them.
const CONSENT_KEY = "masaya_consent_v2";

interface ConsentState {
  accepted: boolean;
  accept: () => void;
}

/**
 * Whether the driver has agreed to location and privacy terms.
 *
 * This lives in a store rather than inside ConsentGate because a second screen
 * needs to know: HomeScreen auto-opens the work-app picker when no app is set,
 * and on a first launch that fired at the same moment as the consent gate. Two
 * modals opened together at the same z-index, so the order they stacked in was
 * arbitrary and the driver had to dismiss both before the app would respond —
 * the first thing a new user saw.
 *
 * Consent is a gate. Nothing else should open in front of it.
 */
export const useConsentStore = create<ConsentState>((set) => ({
  accepted: localStorage.getItem(CONSENT_KEY) === "true",
  accept: () => {
    localStorage.setItem(CONSENT_KEY, "true");
    set({ accepted: true });
  },
}));
