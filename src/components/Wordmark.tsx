import { APP_NAME } from "../config/constants";

/**
 * The Waggle mark: the waggle dance.
 *
 * A forager returning to the hive walks a straight line while waggling her
 * abdomen, then loops back to the start — alternating left and right — so the
 * whole path traces a figure-eight. The ANGLE of that straight run encodes the
 * direction to the food; its DURATION encodes the distance. It is one worker
 * telling the rest of the hive where to go, in heading and kilometres, which is
 * what this app does between drivers.
 *
 * It replaces a hexagon. The hexagon meant "hive" and drew fine, but a hexagon
 * is the most common shape in software branding — it said the right thing in a
 * voice a hundred other products already use. The dance path is specific to
 * this name and this product, and it reads as a ROUTE rather than a container,
 * which is closer to what a driver opens the app for.
 *
 * The run carries the heavy stroke and the loops a lighter one. That is a
 * legibility decision — at 26px three strokes of equal weight close into a
 * blob — and it happens to be biologically true: the run is the signal, the
 * loops are only the walk back to start it again.
 *
 * Strokes rather than fills, so there is no <mask> anywhere in it. That matters
 * beyond tidiness: Android's VectorDrawable has no <mask> element at all, so
 * the previous mark had to be redrawn with its stripes painted in the
 * background colour to survive the port. This one is the same geometry in both
 * places, and still one artwork on currentColor — indigo on white and white on
 * indigo without a second file.
 */
export function BeeMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
    >
      {/* A W drawn as a wave: the letter and the waggle are the same shape.

          Four geometries were tried. The first drew the dance faithfully — two
          lobes sharing the run's endpoints — which closes into an oval with a
          chord through it and stops being a bee at any size: Ø, slashed zero,
          no entry. Moving the loop off-axis produced a closed circle on a
          stick, which is a magnifying glass. A bare diagonal wave fixed both
          and failed differently: elegant at 150px, an ambiguous squiggle at
          40px, and closer to an S than to anything named Waggle.

          The size that decides an app icon is the small one. This is the only
          version that survives it, and it does so without giving up the idea:
          the rounded double-V still reads as the side-to-side motion, and the
          bee still ends her run somewhere.

          A letterform was argued against before this, on the grounds that a
          driver reading Tamil or Arabic gets nothing from Latin initials. That
          objection holds against a typographic monogram and not against this:
          a shape that HAPPENS to be a W costs a non-Latin reader nothing —
          they get a distinctive silhouette either way — while a Latin reader
          gets the name for free. The alternative gave everybody a squiggle. */}
      {/* fill is an INLINE STYLE, not a `fill="none"` attribute.

          The header carries `.wordmark * { fill: currentColor }` so the mark
          turns white over a coloured band. A presentation attribute loses to
          any stylesheet rule, so that `*` reached in here and filled this
          path — the wave became a solid blob on Home, Community, Routes,
          Messages and Profile, while the auth screen (which has no band) was
          fine. One logo on the first screen, a different one everywhere after.

          The previous hexagon mark hit this exact rule and the fix was written
          down in this file; the shape changed and the lesson did not carry
          over. An inline style outranks a stylesheet rule without !important,
          so the stroke survives whatever a parent does to fill. */}
      <path
        d="M11 15 C 12.5 30, 15 35, 17.5 35 C 20 35, 22.5 26, 24 22 C 25.5 26, 28 35, 30.5 35 C 33 34, 35 28, 36 18"
        stroke="currentColor"
        strokeWidth="4.6"
        strokeLinecap="round"
        style={{ fill: "none" }}
      />
      {/* The destination, seated on the end of the final upstroke.

          The one element here for the DRIVER rather than for the bee. A wave
          on its own is a squiggle; a wave arriving at a weighted point is a
          journey with somewhere to be, legible in any country before a word of
          the story is told.

          It costs nothing in truth: the waggle run already points at the food
          source, so marking its head is what the dance means. */}
      <circle cx="36.4" cy="15" r="4.1" fill="currentColor" />
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
 * Re-measured for the W, which is a LETTER standing next to letters, so it is
 * matched on cap height rather than on overall box like the hexagon was.
 *
 * Including the node, the mark spans y10.9 to y37.3 of the 48-unit viewBox —
 * 26.4 units. Jakarta's cap height at the header's 27px was MEASURED in the
 * browser at 21.0px, not the 19.6px this comment claimed for years; that
 * figure came from Inter and survived the font change unnoticed. 38 *
 * (26.4/48) = 20.9px against 21.0px of cap.
 *
 * Worth re-measuring rather than trusting: at the inherited 19.6 the answer
 * came out 36, which is a mark visibly shorter than the word beside it.
 */
export const MARK_SIZE = 38;

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
