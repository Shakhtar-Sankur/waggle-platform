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
      {/* The waggle run.

          The bee walks a STRAIGHT line while waggling side to side, so the
          mark is a straight diagonal drawn as a wave: the path she takes and
          the motion that names the app, in one stroke.

          Two shapes were tried and thrown away first, and both failed for the
          same reason — they were faithful to the dance and illegible as a
          logo. The true figure-eight closes into an oval with the run as a
          chord through it, which stops being a bee at any size and becomes Ø:
          slashed zero, empty set, no entry. Moving the loop off-axis fixed
          that and produced a closed circle on a stick, which is a magnifying
          glass. Accuracy was never the problem in either case.

          A wave along a diagonal has neither failure mode. It cannot close
          into a counter, it has no circle to be mistaken for a lens, and it
          reads as travel and energy to someone who will never hear the word
          "waggle" explained. */}
      <path
        d="M13.5 36.5 C 19.9 35.6, 23 31.8, 22.3 25.3 C 21.6 18.8, 24.6 15, 31 14"
        stroke="currentColor"
        strokeWidth="4.6"
        strokeLinecap="round"
        fill="none"
      />
      {/* The destination, seated ON the end of the run rather than beyond it,
          so the two read as one object instead of a line and a loose dot.

          The one element here for the DRIVER rather than for the bee. A wave
          on its own is a squiggle; a wave arriving at a weighted point is a
          journey with somewhere to be, legible in any country before a word of
          the story is told.

          It costs nothing in truth: the waggle run already points at the food
          source, so marking its head is what the dance means. */}
      <circle cx="31" cy="14" r="4.1" fill="currentColor" />
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
 * Re-measured for the dance, which fills less of its box than the hexagon did.
 * Including the stroke, the artwork spans roughly 9.2 to 38.8 on both axes of
 * the 48-unit viewBox — 29.6 units, or 62%, where the hexagon was 66%. Holding
 * the old 30 would have shrunk the drawn mark from 19.7px to 18.5px, which is
 * the kind of drift that makes a header look subtly wrong without anyone being
 * able to say why.
 *
 * 32 * (29.6/48) = 19.7px of drawn mark against 27px Jakarta's 19.6px caps —
 * the same measured result as before, arrived at through the new geometry
 * rather than by keeping the old number.
 */
export const MARK_SIZE = 32;

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
