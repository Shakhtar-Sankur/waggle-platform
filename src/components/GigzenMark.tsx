import { COMPANY_NAME, COMPANY_SHORT } from "../config/constants";

/**
 * The Gigzen company mark.
 *
 * One closed path traced from the master artwork — the counter reaches the
 * outside through the G's mouth, so the shape is simply connected. Same artwork
 * as the company site, so the app and the site cannot drift apart.
 *
 * MONOCHROME, and it takes the colour of whatever contains it. Light surface →
 * ink; dark or coloured surface → whatever that surface's text colour already
 * is. There is no Gigzen colour to remember and no per-screen exception.
 *
 * Every coloured version needed its own tone per surface, and each new
 * background meant another decision and another contrast measurement. This
 * gives maximum contrast by construction and stops the company mark competing
 * with Buzz's orange.
 *
 * It is also what this artwork was drawn for: one closed path taking
 * currentColor, so it inverts with the theme and needs no second copy. At the
 * 13-16px it renders here, any gradient would be imperceptible anyway.
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
 * Buzz never said who makes it. A worker handing over their location and
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
  // No per-surface special case any more: the mark inherits everywhere, so on
  // the orange auth screen it is white with the rest of the byline, and on the
  // profile screen it is the muted grey, without either being spelled out.
  return (
    <span className={`gigzen-byline ${tone} ${className}`} title={COMPANY_NAME}>
      <GigzenMark size={13} />
      {/* The name is set in capitals as a wordmark, but the constant stays a
          proper noun: it is also the title attribute and feeds the legal
          notice, where GIGZEN PRIVATE LIMITED would be wrong. */}
      <span>
        A <span className="gigzen-word">{COMPANY_SHORT}</span> product
      </span>
    </span>
  );
}
