import { COMPANY_NAME, COMPANY_SHORT } from "../config/constants";

/**
 * The Gigzen company mark.
 *
 * One closed path traced from the master artwork — the counter reaches the
 * outside through the G's mouth, so the shape is simply connected and takes its
 * colour from whatever contains it. Same artwork as the company site, so the app
 * and the site cannot drift apart.
 */
export function GigzenMark({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M33.19 2 L60.1 14.82 L48.54 20.68 L33.66 13.4 L16.25 23.06 L15.14 23.85 L15.14 40.15 L33.19 47.91 L49.02 39.84 L49.34 38.73 L48.54 38.25 L30.34 33.66 L30.5 30.97 L44.43 24.01 L61.05 29.86 L61.05 46.64 L33.5 62 L2.95 46.64 L2.95 17.51 L33.03 2.16 Z"
        fill="currentColor"
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
  return (
    <span className={`gigzen-byline ${tone} ${className}`} title={COMPANY_NAME}>
      <GigzenMark size={13} />
      <span>A {COMPANY_SHORT} product</span>
    </span>
  );
}
