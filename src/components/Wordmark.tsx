import { useId } from "react";
import { APP_NAME } from "../config/constants";

/**
 * The Buzz mark.
 *
 * Geometric rather than illustrative. The previous drawing was a literal bee —
 * an oval abdomen with soft elliptical wings tilted off-axis — which is a fine
 * sticker and a poor logo: at 26px the wings turned to grey fuzz, the tilt made
 * it look slightly crooked rather than dynamic, and it read as clip-art beside
 * type as clean as Jakarta.
 *
 * What replaces it is built from a hexagon and two straight cuts. The hexagon
 * is a honeycomb cell, which does the same job the bee did — hive, swarm, a lot
 * of small journeys adding up — without drawing an insect. Two stripes keep the
 * bee reading, and the wings become two short bars set at the same angle as the
 * hexagon's own shoulders, so every edge in the mark belongs to one geometry
 * instead of curves fighting straight lines.
 *
 * Still one artwork, still currentColor, still a mask: the stripes are cut OUT
 * of the body rather than painted on, so the same file works as indigo on white
 * and as white on indigo without a second version.
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
          {/* Body: a hexagon, flat-topped, on the 48-unit grid. */}
          <path d="M24 13.5 L35.5 20.25 L35.5 33.75 L24 40.5 L12.5 33.75 L12.5 20.25 Z" style={{ fill: "#fff" }} />
          {/* Two cuts, not three. At icon size a third stripe closed up into a
              grey band; two read as stripes and leave the shape legible. */}
          <rect x="9" y="23.6" width="30" height="3.2" style={{ fill: "#000" }} />
          <rect x="9" y="30.4" width="30" height="3.2" style={{ fill: "#000" }} />
        </mask>
      </defs>

      {/* Wings: two bars on the hexagon's own shoulder angle (30 degrees), so
          nothing in the mark sits at an angle the geometry does not already
          use. Squared ends, because a rounded cap at 26px is just a blur. */}
      <rect
        x="2.6"
        y="12.4"
        width="11.5"
        height="3.4"
        transform="rotate(-30 8.35 14.1)"
        fill="currentColor"
        opacity="0.5"
      />
      <rect
        x="33.9"
        y="12.4"
        width="11.5"
        height="3.4"
        transform="rotate(30 39.65 14.1)"
        fill="currentColor"
        opacity="0.5"
      />

      {/* The striped hexagon body. */}
      <path
        d="M24 13.5 L35.5 20.25 L35.5 33.75 L24 40.5 L12.5 33.75 L12.5 20.25 Z"
        fill="currentColor"
        mask={`url(#${id})`}
      />
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
