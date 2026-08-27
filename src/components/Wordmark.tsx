import { useId } from "react";
import { APP_NAME } from "../config/constants";

/**
 * The Buzz bee mark.
 *
 * Drawn with `currentColor` and a mask, so the stripes are cut OUT of the body
 * rather than painted on. That means the same mark reads correctly as orange on
 * a light background (in-app chrome) and as white on orange (auth screen, app
 * icon) without needing two artworks.
 */
export function BeeMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  // Unique per instance so multiple marks on one page don't share a mask id,
  // and stable across re-renders.
  const id = `bee-${useId().replace(/:/g, "")}`;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        {/* The mask's fills are INLINE STYLES, not `fill` attributes.
            A presentation attribute loses to any stylesheet rule, and the
            header carries `.wordmark * { fill: currentColor }` to turn the
            mark white over a coloured band. That `*` reaches in here and
            painted the black stripes white too, so the mask stopped cutting
            and the bee rendered as a plain oval — a different logo on Home
            than on every other screen.

            An inline style outranks a stylesheet rule without needing
            !important, so the mask keeps working whatever a parent does to
            fill. */}
        <mask id={id}>
          {/* White = keep, black = cut away. */}
          <rect x="0" y="0" width="48" height="48" style={{ fill: "#000" }} />
          <rect x="14" y="15" width="20" height="26" rx="10" style={{ fill: "#fff" }} />
          {/* Three thin stripes cut out — reads as a bee, not a face. */}
          <rect x="12" y="23.2" width="24" height="2.8" rx="1.4" style={{ fill: "#000" }} />
          <rect x="12" y="29.4" width="24" height="2.8" rx="1.4" style={{ fill: "#000" }} />
          <rect x="12" y="35.6" width="24" height="2.8" rx="1.4" style={{ fill: "#000" }} />
        </mask>
      </defs>

      {/* Wings — small, swept up and back so the striped body leads the shape. */}
      <ellipse
        cx="13.4"
        cy="13.2"
        rx="6.4"
        ry="3.7"
        transform="rotate(-38 13.4 13.2)"
        fill="currentColor"
        opacity="0.42"
      />
      <ellipse
        cx="34.6"
        cy="13.2"
        rx="6.4"
        ry="3.7"
        transform="rotate(38 34.6 13.2)"
        fill="currentColor"
        opacity="0.42"
      />

      {/* Striped body. */}
      <rect x="14" y="15" width="20" height="26" rx="10" fill="currentColor" mask={`url(#${id})`} />
    </svg>
  );
}

/**
 * Full lockup: bee mark + the name. `tone="solid"` inherits the current colour
 * (used on the orange auth screen); the default draws the name in the brand
 * gradient for the light in-app chrome.
 */
/**
 * One size for the mark, everywhere it appears.
 *
 * 30, not 26, and the difference is the viewBox. The artwork occupies y9.5
 * to y41 of a 48-unit box — 31.5 units, or 66% — so the drawn bee is
 * two-thirds of whatever number is set here. At 26 that meant a 17.1px bee
 * standing next to a 19.6px cap height, which is why it read as too small
 * beside the word even though the box was the same size as the type.
 *
 * 30 * (31.5/48) = 19.7px of drawn bee against 27px Inter's 19.6px caps.
 * Matched by measurement rather than by matching the numbers that are easy
 * to see in the markup.
 */
export const MARK_SIZE = 30;

export function Wordmark({
  size = 22,
  markSize = MARK_SIZE,
  tone = "gradient",
  className = "",
}: {
  size?: number;
  /** The bee. Defaults to MARK_SIZE and should almost never be passed. */
  markSize?: number;
  tone?: "gradient" | "solid";
  className?: string;
}) {
  return (
    <span className={`wordmark ${tone === "solid" ? "solid" : ""} ${className}`}>
      {/* The mark used to be `size * 1.18`, so it scaled with the WORD next to
          it: the header passes 27 and got a 32px bee, the profile footer passes
          24 and got 28, while every screen that draws the mark on its own uses
          26. Three sizes for one logo, and no amount of aligning the callers
          could fix it while the mark was derived from the text.

          The word can still be sized for its context. The mark cannot — it is
          the logo, and a logo is one size. */}
      <BeeMark size={markSize} className="wordmark-bee" />
      <span className="wordmark-text" style={{ fontSize: size }}>
        {APP_NAME}
      </span>
    </span>
  );
}
