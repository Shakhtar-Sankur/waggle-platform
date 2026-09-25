import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

/** Where the customer wants things delivered: what the home screen and search show shops for. */
export interface Place {
  lat: number;
  lng: number;
  /** "Saheed Nagar", or "Current location" until the customer names it. */
  area: string;
  address?: string;
  label?: "home" | "work" | "other" | "gps" | "pin";
}

// Private windows and blocked storage: the app still works, it just forgets.
const safeStorage: StateStorage = {
  getItem: (name) => { try { return localStorage.getItem(name); } catch { return null; } },
  setItem: (name, value) => { try { localStorage.setItem(name, value); } catch { /* not remembered */ } },
  removeItem: (name) => { try { localStorage.removeItem(name); } catch { /* nothing to remove */ } },
};

export const useWaggleLocation = create<{ place: Place | null; setPlace: (p: Place) => void }>()(
  persist(
    (set) => ({
      place: null,
      setPlace: (place) => set({ place }),
    }),
    { name: "waggle_place", storage: createJSONStorage(() => safeStorage) },
  ),
);
