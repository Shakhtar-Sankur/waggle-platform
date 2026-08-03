import { useId } from "react";
import { APP_NAME } from "../config/constants";

/**
 * The Buzz Buzz bee mark.
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
        <mask id={id}>
          {/* White = keep, black = cut away. */}
          <rect x="0" y="0" width="48" height="48" fill="black" />
          <rect x="14" y="15" width="20" height="26" rx="10" fill="white" />
          {/* Three thin stripes cut out — reads as a bee, not a face. */}
          <rect x="12" y="23.2" width="24" height="2.8" rx="1.4" fill="black" />
          <rect x="12" y="29.4" width="24" height="2.8" rx="1.4" fill="black" />
          <rect x="12" y="35.6" width="24" height="2.8" rx="1.4" fill="black" />
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
export function Wordmark({
  size = 22,
  tone = "gradient",
  className = "",
}: {
  size?: number;
  tone?: "gradient" | "solid";
  className?: string;
}) {
  return (
    <span className={`wordmark ${tone === "solid" ? "solid" : ""} ${className}`}>
      <BeeMark size={size * 1.18} className="wordmark-bee" />
      <span className="wordmark-text" style={{ fontSize: size }}>
        {APP_NAME}
      </span>
    </span>
  );
}
