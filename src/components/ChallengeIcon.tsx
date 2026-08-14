import { Bike, Car, Coins, Flag, HandHeart, Map, Target, Trophy, Zap } from "lucide-react";

/**
 * A line icon for a challenge or group, replacing the emoji these carried.
 *
 * Emoji were the wrong shape for this UI twice over: they are full-colour
 * cartoons among line icons, and every Android version draws them differently,
 * so a 🏆 that looks fine on one phone is a different illustration on the next.
 *
 * Challenges created before this still hold an emoji string, and drivers can
 * type one when creating their own, so the emoji is mapped where it is
 * recognised and falls back to a target rather than rendering nothing.
 */

const BY_EMOJI: Record<string, typeof Trophy> = {
  "🏆": Trophy,
  "🗺️": Map,
  "🗺": Map,
  "🤝": HandHeart,
  "🚗": Car,
  "🏍️": Bike,
  "🏍": Bike,
  "🛵": Bike,
  "🎯": Target,
  "⚡": Zap,
  "💰": Coins,
  "🚩": Flag,
};

interface Props {
  /** Whatever the challenge stored — an emoji, or nothing. */
  icon?: string;
  size?: number;
}

export function ChallengeIcon({ icon, size = 22 }: Props) {
  const Icon = (icon && BY_EMOJI[icon.trim()]) || Target;
  return <Icon size={size} aria-hidden="true" />;
}
