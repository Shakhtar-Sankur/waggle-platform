/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "business" builds Waggle Business; anything else builds Waggle Gig. */
  readonly VITE_APP_FLAVOR?: string;
  /** "true" shows phone sign-in in Waggle; needs an SMS provider on the backend. */
  readonly VITE_OTP_ENABLED?: string;
}
