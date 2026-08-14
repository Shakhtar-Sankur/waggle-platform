import { useId } from "react";
import { COMPANY_NAME, COMPANY_SHORT } from "../config/constants";

/**
 * The Gigzen company mark.
 *
 * One closed path traced from the master artwork — the counter reaches the
 * outside through the G's mouth, so the shape is simply connected. Same artwork
 * as the company site, so the app and the site cannot drift apart.
 *
 * Painted in the company blue rather than `currentColor`. The gradient's light
 * stop is #6FB4F5 and not the paler blue the sites first used: this mark renders
 * at 13-16px, and a stop light enough to disappear against a white row turns the
 * silhouette into a smudge. Logos are exempt from the contrast minimum, which
 * is not the same as being legible.
 *
 * Pass `inherit` where the mark sits on a coloured surface — the orange auth
 * header, or anywhere the surrounding text colour is already carrying it.
 */
export function GigzenMark({
  size = 16,
  className = "",
  inherit = false,
}: {
  size?: number;
  className?: string;
  inherit?: boolean;
}) {
  // Unique per instance: several marks render on one screen, and a shared
  // gradient id would make every instance after the first resolve to the
  // first one's definition.
  const id = `gz-${useId().replace(/:/g, "")}`;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
    >
      {!inherit && (
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#6FB4F5" />
            <stop offset="0.55" stopColor="#2E7FE0" />
            <stop offset="1" stopColor="#0038B8" />
          </linearGradient>
        </defs>
      )}
      <path
        d="M33.19 2 L60.1 14.82 L48.54 20.68 L33.66 13.4 L16.25 23.06 L15.14 23.85 L15.14 40.15 L33.19 47.91 L49.02 39.84 L49.34 38.73 L48.54 38.25 L30.34 33.66 L30.5 30.97 L44.43 24.01 L61.05 29.86 L61.05 46.64 L33.5 62 L2.95 46.64 L2.95 17.51 L33.03 2.16 Z"
        fill={inherit ? "currentColor" : `url(#${id})`}
      />
    </svg>
  );
}

/**
 * "A Gigzen product" — the mark plus the line, as one unit.
 *
 * Buzz Buzz never said who makes it. A worker handing over their location and
 * their earnings deserves to know which company is on the other end, and it is
 * the same answer the legal pages now give.
 */
export function GigzenByline({
  tone = "muted",
  className = "",
}: {
  tone?: "muted" | "solid";
  className?: string;
}) {
  // The solid tone sits on the orange auth screen, where the whole byline is
  // white at reduced opacity. A blue mark there would be the one element not
  // participating in that, so on this surface it inherits instead.
  return (
    <span className={`gigzen-byline ${tone} ${className}`} title={COMPANY_NAME}>
      <GigzenMark size={13} inherit={tone === "solid"} />
      <span>A {COMPANY_SHORT} product</span>
    </span>
  );
}
