import { Bike, Car } from "lucide-react";
import type { VehicleType } from "../types";

/**
 * The three vehicles.
 *
 * They were emoji — 🚗 🏍️ 🚲 — because lucide has no motorcycle glyph, and
 * using its bicycle for both made motorcycle and bicycle identical. Emoji fixed
 * that and brought a worse problem: the platform draws them, so the picker was
 * colour clip-art on one phone and a flat outline on another, in a sheet where
 * everything else is a line icon.
 *
 * Two of the three come from lucide, so they are the same hand as the rest of
 * the app's icons. Only the motorcycle is drawn here, because that is the one
 * lucide actually lacks — and drawing all three myself, which was the first
 * attempt, produced a motorcycle and a bicycle that were two circles and a
 * frame apiece and unreadable as different things at 26px.
 *
 * What separates this motorcycle from lucide's Bike, deliberately: an engine
 * block in the middle where a bicycle has an open diamond, hubbed wheels
 * against the bicycle's empty rims, and a stubby tail instead of a saddle post.
 * Those read at 26px; wheel thickness alone does not.
 */
export function VehicleIcon({
  type,
  size = 24,
}: {
  type: VehicleType;
  size?: number;
}) {
  if (type === "car") return <Car size={size} strokeWidth={1.7} aria-hidden />;
  if (type === "bicycle") return <Bike size={size} strokeWidth={1.7} aria-hidden />;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {/* Wheels, with hubs — the bicycle's are empty rims. */}
      <circle cx="5" cy="16.5" r="3.5" />
      <circle cx="19" cy="16.5" r="3.5" />
      <circle cx="5" cy="16.5" r="0.6" />
      <circle cx="19" cy="16.5" r="0.6" />
      {/* The engine, which is the whole difference at small sizes. */}
      <rect x="9.2" y="11.6" width="5.6" height="3.8" rx="1.1" />
      {/* Frame: engine back to the rear wheel, and forward to the fork. */}
      <path d="M9.2 14.2 6.6 16" />
      <path d="M14.8 12.4h2.1l1.6 3.5" />
      {/* Handlebar and the stubby tail over the rear wheel. */}
      <path d="M15.4 9.9h3.1" />
      <path d="M16.9 9.9 16.2 12" />
      <path d="M9.4 11.6 8.4 9.4h3.1" />
    </svg>
  );
}
