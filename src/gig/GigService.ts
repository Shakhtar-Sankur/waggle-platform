import { supabase } from "../services/SupabaseService";

/**
 * The rider app's own data: earnings, history, the rider hub and help. Every
 * figure comes from the database (supabase/gig_v2.sql); nothing is estimated on
 * the phone.
 */

export interface EarningsDay {
  day: string;
  deliveries: number;
  fare: number;
  km: number;
  onlineMinutes: number;
}

export interface Earnings {
  from: string;
  to: string;
  deliveries: number;
  fare: number;
  km: number;
  shopPaid: number;
  shopWaiting: number;
  shopDisputed: number;
  onlineMinutes: number;
  days: EarningsDay[];
}

export interface Delivery {
  id: string;
  pickup: string;
  dropoff: string;
  km: number;
  fare: number;
  source: "app" | "api" | "order";
  reference: string | null;
  createdAt: string;
  acceptedAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string;
  paidAt: string | null;
  utr: string | null;
  disputedAt: string | null;
  shopName: string | null;
  shopKind: string | null;
  shopPhone: string | null;
}

export type NoticeKind = "news" | "zone_alert" | "safety";

export interface Notice {
  id: string;
  kind: NoticeKind;
  title: string;
  body: string;
  area: string | null;
  startsAt: string;
  endsAt: string | null;
  radiusKm: number | null;
  kmAway: number | null;
}

export type TicketTopic = "payment" | "delivery" | "account" | "app" | "safety" | "other";

export interface Ticket {
  id: string;
  topic: TicketTopic;
  message: string;
  status: "open" | "answered" | "closed";
  reply: string | null;
  repliedAt: string | null;
  createdAt: string;
  jobId: string | null;
}

/** A customer's parcel, for the rider carrying it: both people and what it is. */
export interface SendDetails {
  code: string;
  pickupName: string;
  pickupPhone: string;
  dropName: string;
  dropPhone: string;
  kind: string;
  size: string;
  fragile: boolean;
  description: string | null;
  fare: number;
  photoTaken: boolean;
}

export interface ShopContact {
  name: string;
  phone: string | null;
  address: string;
  kind: string;
}

function need() {
  if (!supabase) throw new Error("Waggle is offline");
  return supabase;
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await need().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

/** A calendar day in India time, as the database counts them. */
export function istDay(offsetDays = 0, from = Date.now()): string {
  return new Date(from + 5.5 * 3600e3 + offsetDays * 864e5).toISOString().slice(0, 10);
}

export const GigService = {
  async earnings(from: string, to: string): Promise<Earnings> {
    const r = await rpc<any>("my_earnings", { p_from: from, p_to: to });
    const tot = r?.totals ?? {};
    return {
      from: r.from,
      to: r.to,
      deliveries: Number(tot.deliveries ?? 0),
      fare: Number(tot.fare ?? 0),
      km: Number(tot.km ?? 0),
      shopPaid: Number(tot.shop_paid ?? 0),
      shopWaiting: Number(tot.shop_waiting ?? 0),
      shopDisputed: Number(tot.shop_disputed ?? 0),
      onlineMinutes: Number(tot.online_minutes ?? 0),
      days: (r?.days ?? []).map((d: any) => ({
        day: d.day, deliveries: Number(d.deliveries), fare: Number(d.fare), km: Number(d.km), onlineMinutes: Number(d.online_minutes),
      })),
    };
  },

  async history(before?: string, limit = 30): Promise<Delivery[]> {
    const rows = await rpc<any[]>("my_job_history", { p_before: before ?? null, p_limit: limit });
    return (rows ?? []).map((j) => ({
      id: j.id,
      pickup: j.pickup,
      dropoff: j.dropoff,
      km: Number(j.distance_km),
      fare: Number(j.payout),
      source: j.source ?? "app",
      reference: j.external_ref ?? null,
      createdAt: j.created_at,
      acceptedAt: j.accepted_at,
      pickedUpAt: j.picked_up_at,
      deliveredAt: j.delivered_at,
      paidAt: j.rider_paid_at,
      utr: j.rider_pay_utr,
      disputedAt: j.rider_pay_disputed_at,
      shopName: j.shop_name,
      shopKind: j.shop_kind,
      shopPhone: j.shop_phone,
    }));
  },

  async hub(lat?: number, lng?: number): Promise<Notice[]> {
    const rows = await rpc<any[]>("rider_hub", { p_lat: lat ?? null, p_lng: lng ?? null });
    return (rows ?? []).map((a) => ({
      id: a.id, kind: a.kind, title: a.title, body: a.body, area: a.area, startsAt: a.starts_at, endsAt: a.ends_at,
      radiusKm: a.radius_km == null ? null : Number(a.radius_km), kmAway: a.km_away == null ? null : Number(a.km_away),
    }));
  },

  async tickets(): Promise<Ticket[]> {
    const { data, error } = await need()
      .from("support_tickets")
      .select("id, topic, message, status, reply, replied_at, created_at, job_id")
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw new Error(error.message);
    return (data ?? []).map((t: any) => ({
      id: t.id, topic: t.topic, message: t.message, status: t.status, reply: t.reply, repliedAt: t.replied_at, createdAt: t.created_at, jobId: t.job_id,
    }));
  },

  async openTicket(topic: TicketTopic, message: string, jobId?: string): Promise<void> {
    await rpc("open_ticket", { p_topic: topic, p_message: message.trim(), p_job: jobId ?? null, p_app: "gig" });
  },

  async shopContact(jobId: string): Promise<ShopContact | null> {
    return rpc<ShopContact | null>("job_shop_contact", { p_job: jobId });
  },

  async sendDetails(jobId: string): Promise<SendDetails | null> {
    const d = await rpc<any>("job_send_details", { p_job: jobId });
    if (!d) return null;
    return {
      code: d.code, pickupName: d.pickup_name, pickupPhone: d.pickup_phone, dropName: d.drop_name, dropPhone: d.drop_phone,
      kind: d.kind, size: d.size, fragile: Boolean(d.fragile), description: d.description ?? null, fare: Number(d.fare), photoTaken: Boolean(d.photo_taken),
    };
  },

  /** The parcel photo, the rider's proof of what they took. Required before the pickup code. */
  async uploadParcelPhoto(jobId: string, photo: Blob): Promise<void> {
    const path = `${jobId}/${crypto.randomUUID()}.jpg`;
    const { error } = await need().storage.from("send-photos").upload(path, photo, { contentType: "image/jpeg", upsert: false });
    if (error) throw new Error(error.message);
    const answer = await rpc<string>("record_parcel_photo", { p_job: jobId, p_path: path });
    if (answer !== "ok") throw new Error(answer === "not_yours" ? "This parcel is not yours to photograph." : "The photo could not be saved.");
  },

  /** Where pickups have been in the last 14 days near the rider: counts in ~1 km squares. */
  async demand(lat: number, lng: number): Promise<{ lat: number; lng: number; pickups: number }[]> {
    const rows = await rpc<any[]>("demand_near", { p_lat: lat, p_lng: lng, p_km: 8 });
    return (rows ?? []).map((c) => ({ lat: Number(c.lat), lng: Number(c.lng), pickups: Number(c.pickups) }));
  },

  async setLocationSharing(share: boolean): Promise<void> {
    await rpc("set_location_sharing", { p_share: share });
  },
};
