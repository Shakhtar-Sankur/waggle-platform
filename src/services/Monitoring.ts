/**
 * Crash reporting.
 *
 * Until now nothing reported failures from a real device: a driver in Jakarta
 * hitting a bug produced no signal anywhere, so the only bugs we could fix were
 * the ones someone remembered to describe.
 *
 * Inert unless VITE_SENTRY_DSN is set, so a build without a DSN behaves exactly
 * as before and no data leaves the device.
 *
 * What this deliberately does NOT send:
 *   · phone numbers — the login identifier, and personally identifying
 *   · GPS coordinates — where a driver is, all day, is the most sensitive thing
 *     this app touches, and it has no place in a crash report
 *   · message and post text — their words are theirs
 *
 * The privacy policy promises location is used for distance and earnings. Piping
 * it to a third party for debugging would quietly break that promise.
 */
import * as Sentry from "@sentry/react";

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;

/** Anything matching these is stripped before an event leaves the device. */
// No leading \b: it would not match before a "+", leaving "+[phone]" behind.
const PHONE = /\+?\d[\d\s-]{8,}\d/g;
const COORD = /-?\d{1,3}\.\d{4,}/g;

function scrub<T>(value: T): T {
  if (typeof value === "string") {
    return value.replace(PHONE, "[phone]").replace(COORD, "[coord]") as unknown as T;
  }
  if (Array.isArray(value)) return value.map(scrub) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Drop the fields outright rather than trusting a regex to catch them.
      if (/phone|password|token|lat|lng|latitude|longitude|body|message/i.test(k)) continue;
      out[k] = scrub(v);
    }
    return out as unknown as T;
  }
  return value;
}

export const Monitoring = {
  enabled: Boolean(DSN),

  init() {
    if (!DSN) return;
    Sentry.init({
      dsn: DSN,
      // Ties a crash to the exact build a driver is running, which is the
      // difference between "someone crashed" and "1.1 crashes on signup".
      release: `buzz-buzz@${import.meta.env.VITE_APP_VERSION ?? "dev"}`,
      environment: import.meta.env.MODE,
      sendDefaultPii: false,
      tracesSampleRate: 0.1,
      beforeSend(event) {
        delete event.user;
        if (event.request?.url) event.request.url = scrub(event.request.url);
        if (event.breadcrumbs) event.breadcrumbs = scrub(event.breadcrumbs);
        if (event.extra) event.extra = scrub(event.extra);
        if (event.exception?.values) {
          event.exception.values = event.exception.values.map((v) => ({
            ...v,
            value: v.value ? scrub(v.value) : v.value,
          }));
        }
        return event;
      },
    });
  },

  /**
   * Report a handled failure — something we recovered from but still want to
   * know about, like a queued write that kept failing.
   */
  capture(error: unknown, context?: Record<string, unknown>) {
    if (!DSN) return;
    Sentry.captureException(error, context ? { extra: scrub(context) } : undefined);
  },
};
