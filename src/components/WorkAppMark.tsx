import type { WorkApp } from "../types";

/**
 * A platform's mark: its initials, set in its own brand colour.
 *
 * These were emoji — 🚖 for Uber, 🍔 for Uber Eats, 🚪 for DoorDash. Emoji are
 * the single biggest reason the app read as cartoonish: they are full-colour
 * illustrations in a UI made of line icons, they render differently on every
 * Android version and OEM skin, and some were puns (a literal door) that say
 * nothing about the brand.
 *
 * Initials in the brand colour are calmer, consistent everywhere, legible at
 * 20px, and carry no trademark risk — which real logos would.
 */

/** "Uber Eats" → "UE", "DoorDash" → "DD", "Angkas" → "A", "foodpanda" → "F". */
function monogram(name: string): string {
  const words = name.trim().split(/[\s-]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();

  // One word, but written as two — DoorDash, ShopeeFood, BigBasket.
  const camel = name.match(/^([A-Za-z])[a-z]*([A-Z])/);
  if (camel) return (camel[1] + camel[2]).toUpperCase();

  // Otherwise a single letter. "UB", "AN", "IN" read as abbreviations of
  // nothing; "U", "A", "I" read as marks.
  return name.slice(0, 1).toUpperCase();
}

interface Props {
  app?: WorkApp | null;
  size?: number;
  /** Filled chip (lists, pickers) vs bare text (inline in a sentence). */
  variant?: "chip" | "inline";
}

export function WorkAppMark({ app, size = 26, variant = "chip" }: Props) {
  if (!app) return null;
  const text = monogram(app.name);

  if (variant === "inline") {
    return (
      <span className="wam-inline" style={{ color: app.color }}>
        {text}
      </span>
    );
  }

  return (
    <span
      className="wam"
      style={{
        width: size,
        height: size,
        background: app.color,
        // Two characters need to shrink to stay inside the same chip.
        fontSize: Math.round(size * (text.length > 1 ? 0.38 : 0.46)),
      }}
      aria-hidden="true"
    >
      {text}
    </span>
  );
}
