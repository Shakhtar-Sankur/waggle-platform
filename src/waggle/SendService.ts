import { supabase } from "../services/SupabaseService";

/** Waggle Send: a customer's parcel, carried by a Waggle rider (supabase/send_v1.sql). */

export type ParcelKind = "documents" | "food" | "clothes" | "electronics" | "keys" | "medicine" | "other";
export type ParcelSize = "envelope" | "small" | "medium";
export type SendStatus = "booked" | "assigned" | "picked_up" | "delivered" | "cancelled";

export interface SendQuote {
  km: number;
  fare: number;
  feeRupees: number;
  feeLive: boolean;
  feeUpi: string | null;
  total: number;
  tooFar: boolean;
  tooClose: boolean;
}

export interface SendPlace {
  name: string;
  phone: string;
  area: string;
  address: string;
  lat: number;
  lng: number;
}

export interface NewSend {
  pickup: SendPlace;
  drop: SendPlace;
  kind: ParcelKind;
  size: ParcelSize;
  fragile: boolean;
  description: string;
  riderNote: string;
  bannedAck: boolean;
  scheduledFor: string | null;
  feeUtr: string | null;
}

export interface TrackedSend {
  code: string;
  status: SendStatus;
  viewer: "sender" | "recipient";
  kind: ParcelKind;
  size: ParcelSize;
  fragile: boolean;
  pickup: { name: string; area: string; lat: number; lng: number };
  drop: { name: string; area: string; lat: number; lng: number };
  km: number;
  scheduledFor: string | null;
  createdAt: string;
  assignedAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  fare: number | null;
  feeRupees: number | null;
  feeWaived: boolean | null;
  pickupCode: string | null;
  deliveryCode: string | null;
  shareToken: string | null;
  rider: { firstName: string; vehicle: string | null; plateLast4: string; upi: string | null } | null;
  riderAt: { lat: number; lng: number; at: string } | null;
}

export interface MySend {
  code: string;
  token: string;
  status: SendStatus;
  dropName: string;
  dropArea: string;
  pickupArea: string;
  fare: number;
  createdAt: string;
  deliveredAt: string | null;
}

function need() {
  if (!supabase) throw new Error("Waggle needs a connection to the server.");
  return supabase;
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await need().rpc(fn, args);
  if (error) throw new Error(error.message || "Something went wrong. Try again.");
  return data as T;
}

export const SendService = {
  async quote(pick: { lat: number; lng: number }, drop: { lat: number; lng: number }): Promise<SendQuote> {
    const q = await rpc<any>("send_quote", { p_pick_lat: pick.lat, p_pick_lng: pick.lng, p_drop_lat: drop.lat, p_drop_lng: drop.lng });
    return {
      km: Number(q.km), fare: Number(q.fare), feeRupees: Number(q.fee_paise) / 100, feeLive: Boolean(q.fee_live), feeUpi: q.fee_upi ?? null,
      total: Number(q.total), tooFar: Boolean(q.too_far), tooClose: Boolean(q.too_close),
    };
  },

  async book(s: NewSend): Promise<{ code: string; token: string; shareToken: string }> {
    const r = await rpc<any>("book_send", {
      p_pick_name: s.pickup.name, p_pick_phone: s.pickup.phone, p_pick_area: s.pickup.area, p_pick_address: s.pickup.address,
      p_pick_lat: s.pickup.lat, p_pick_lng: s.pickup.lng,
      p_drop_name: s.drop.name, p_drop_phone: s.drop.phone, p_drop_area: s.drop.area, p_drop_address: s.drop.address,
      p_drop_lat: s.drop.lat, p_drop_lng: s.drop.lng,
      p_kind: s.kind, p_size: s.size, p_fragile: s.fragile, p_description: s.description || null, p_rider_note: s.riderNote || null,
      p_banned_ack: s.bannedAck, p_scheduled_for: s.scheduledFor, p_fee_utr: s.feeUtr,
    });
    return { code: r.code, token: r.token, shareToken: r.share_token };
  },

  async track(token: string): Promise<TrackedSend | null> {
    const t = await rpc<any>("track_send", { p_token: token });
    if (!t) return null;
    return {
      code: t.code, status: t.status, viewer: t.viewer, kind: t.kind, size: t.size, fragile: Boolean(t.fragile),
      pickup: t.pickup, drop: t.drop, km: Number(t.km), scheduledFor: t.scheduled_for,
      createdAt: t.created_at, assignedAt: t.assigned_at, pickedUpAt: t.picked_up_at, deliveredAt: t.delivered_at, cancelledAt: t.cancelled_at,
      fare: t.fare == null ? null : Number(t.fare), feeRupees: t.fee_paise == null ? null : Number(t.fee_paise) / 100, feeWaived: t.fee_waived ?? null,
      pickupCode: t.pickup_code ?? null, deliveryCode: t.delivery_code ?? null, shareToken: t.share_token ?? null,
      rider: t.rider ? { firstName: t.rider.first_name, vehicle: t.rider.vehicle ?? null, plateLast4: t.rider.plate_last4 ?? "", upi: t.rider.upi ?? null } : null,
      riderAt: t.rider_at ? { lat: Number(t.rider_at.lat), lng: Number(t.rider_at.lng), at: t.rider_at.at } : null,
    };
  },

  async cancel(token: string, reason?: string): Promise<string> {
    return rpc<string>("cancel_send", { p_token: token, p_reason: reason ?? null });
  },

  async mine(): Promise<MySend[]> {
    const rows = await rpc<any[]>("my_sends");
    return (rows ?? []).map((r) => ({
      code: r.code, token: r.token, status: r.status, dropName: r.drop_name, dropArea: r.drop_area, pickupArea: r.pickup_area,
      fare: Number(r.fare), createdAt: r.created_at, deliveredAt: r.delivered_at,
    }));
  },
};
