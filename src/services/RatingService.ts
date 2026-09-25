import { supabase } from "./SupabaseService";

/** Rider ratings (supabase/ratings_v1.sql). Nobody reads a rating's author; riders see totals. */

export interface RiderStanding {
  avg: number | null;
  count: number;
  stars: Record<"1" | "2" | "3" | "4" | "5", number>;
}

export interface DeliveryRating {
  /** The rider's average, once they have 3 ratings. */
  avg: number | null;
  count: number;
  canRate: boolean;
  /** This viewer's own rating of this delivery, if given. */
  rated: number | null;
}

export interface AdminRatings {
  riders: { riderId: string; name: string; avg: number; count: number; low: number }[];
  low: { riderId: string; name: string; stars: number; rater: "customer" | "shop" | "sender"; reason: string | null; job: string; at: string }[];
}

export type RateAnswer = "ok" | "already" | "not_yet" | "too_late" | "invalid" | "not_found" | "not_yours";

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!supabase) throw new Error("Waggle needs a connection to the server.");
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message || "Something went wrong. Try again.");
  return data as T;
}

export const RatingService = {
  /** Customer (order tracking token) or sender (Send token). */
  async forDelivery(token: string): Promise<DeliveryRating | null> {
    const r = await rpc<any>("delivery_rider_rating", { p_token: token });
    if (!r) return null;
    return { avg: r.avg == null ? null : Number(r.avg), count: Number(r.count ?? 0), canRate: Boolean(r.can_rate), rated: r.rated ?? null };
  },

  rateFromOrder(token: string, stars: number, reason: string): Promise<RateAnswer> {
    return rpc<RateAnswer>("rate_rider_order", { p_token: token, p_stars: stars, p_reason: reason || null });
  },

  rateFromSend(token: string, stars: number, reason: string): Promise<RateAnswer> {
    return rpc<RateAnswer>("rate_rider_send", { p_token: token, p_stars: stars, p_reason: reason || null });
  },

  rateFromShop(jobId: string, stars: number, reason: string): Promise<RateAnswer> {
    return rpc<RateAnswer>("shop_rate_rider", { p_job: jobId, p_stars: stars, p_reason: reason || null });
  },

  async shopRating(jobId: string): Promise<number | null> {
    return (await rpc<number | null>("shop_job_rating", { p_job: jobId })) ?? null;
  },

  async mine(): Promise<RiderStanding | null> {
    const r = await rpc<any>("my_rider_rating");
    if (!r) return null;
    return { avg: r.avg == null ? null : Number(r.avg), count: Number(r.count ?? 0), stars: r.stars };
  },

  async admin(): Promise<AdminRatings> {
    const r = await rpc<any>("admin_rider_ratings");
    return {
      riders: (r?.riders ?? []).map((x: any) => ({ riderId: x.rider_id, name: x.name ?? "—", avg: Number(x.avg), count: Number(x.count), low: Number(x.low) })),
      low: (r?.low ?? []).map((x: any) => ({ riderId: x.rider_id, name: x.name ?? "—", stars: x.stars, rater: x.rater, reason: x.reason, job: x.job, at: x.at })),
    };
  },
};
