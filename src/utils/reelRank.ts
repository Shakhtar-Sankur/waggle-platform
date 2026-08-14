import type { FeedPost } from "../types";

/**
 * Ranking for the reels feed.
 *
 * "Viral" here means a reel that earned attention quickly, not one that simply
 * has the most likes. A three-week-old clip with 40 likes should not outrank an
 * hour-old one with 12 — otherwise the tab freezes into a hall of fame and a new
 * driver's first post is never seen, which is the fastest way to make people
 * stop posting.
 *
 * So the score is engagement decayed by age, in the shape Hacker News and Reddit
 * use:
 *
 *     score = (engagement + 1) / (hours + 2) ^ gravity
 *
 * The +1 gives a brand-new reel with no likes a non-zero score so it appears at
 * all. The +2 stops the first minutes being a divide-by-almost-zero spike. The
 * exponent decides how fast yesterday stops mattering.
 *
 * A comment counts for more than a like because it costs more to leave. This is
 * a heuristic, deliberately: it is inspectable and predictable, which matters
 * more here than sophistication, and there is no training data to do better.
 */

const GRAVITY = 1.5;
const LIKE_WEIGHT = 1;
const COMMENT_WEIGHT = 3;

export function reelScore(post: FeedPost, now = Date.now()): number {
  const engagement = post.likes * LIKE_WEIGHT + post.commentCount * COMMENT_WEIGHT;
  const hours = Math.max(0, (now - post.createdAt) / 3_600_000);
  return (engagement + 1) / Math.pow(hours + 2, GRAVITY);
}

/**
 * Reels, best first.
 *
 * `mine` is passed so a driver's own brand-new reel is never buried below other
 * people's — seeing your own post appear is what tells you it worked.
 */
export function rankReels(posts: FeedPost[], myUserId?: string, now = Date.now()): FeedPost[] {
  const reels = posts.filter((p) => p.videoUrl);
  return [...reels].sort((a, b) => {
    // A reel of your own from the last few minutes pins to the top.
    const aFresh = a.userId === myUserId && now - a.createdAt < 5 * 60_000;
    const bFresh = b.userId === myUserId && now - b.createdAt < 5 * 60_000;
    if (aFresh !== bFresh) return aFresh ? -1 : 1;
    return reelScore(b, now) - reelScore(a, now);
  });
}

/**
 * Whether a reel is doing unusually well, for a "trending" marker.
 *
 * Relative to the current feed rather than an absolute like count: on a small
 * app any fixed threshold is either never met or always met.
 */
export function isTrending(post: FeedPost, all: FeedPost[], now = Date.now()): boolean {
  const reels = all.filter((p) => p.videoUrl);
  if (reels.length < 3) return false;                 // too small a sample to call
  const scores = reels.map((p) => reelScore(p, now)).sort((a, b) => b - a);
  const cutoff = scores[Math.max(0, Math.floor(scores.length * 0.2) - 1)];
  return reelScore(post, now) >= cutoff && post.likes + post.commentCount > 0;
}
