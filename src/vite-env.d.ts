/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "business" builds Waggle Business; anything else builds Waggle Gig. */
  readonly VITE_APP_FLAVOR?: string;
}
