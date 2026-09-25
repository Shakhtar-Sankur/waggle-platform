import { photoUrl, type BusinessKind, type Diet, type OrderStatus } from "../business/BusinessService";
import { supabase } from "../services/SupabaseService";

/**
 * The Waggle app's own questions to the backend: which shops deliver here,
 * search across them, the customer's saved places and orders. Shops, prices and
 * every limit are the database's; nothing here can widen what a customer sees.
 */

export type Segment = "food" | "shop";

export interface NearbyShop {
  id: string;
  name: string;
  kind: BusinessKind;
  segment: Segment;
  address: string;
  open: boolean;
  deliveryRupees: number;
  prepMinutes: number | null;
  km: number;
  rating: number | null;
  ratings: number;
  items: number;
  pureVeg: boolean;
  coverUrl: string | null;
  fromRupees: number | null;
}

export interface SearchItem {
  id: string;
  name: string;
  priceRupees: number;
  mrpRupees: number | null;
  diet: Diet | null;
  quantityLabel: string | null;
  brand: string | null;
  photoUrl: string | null;
  soldOut: boolean;
  shopId: string;
  shop: string;
  open: boolean;
  km: number;
}

export interface SavedAddress {
  id: string;
  label: "home" | "work" | "other";
  area: string;
  address: string;
  lat: number;
  lng: number;
}

export interface MyOrder {
  token: string;
  code: string;
  status: OrderStatus;
  totalRupees: number;
  createdAt: string;
  shop: string;
  shopId: string;
  items: number;
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

export const WaggleService = {
  async nearby(lat: number, lng: number, segment: Segment): Promise<NearbyShop[]> {
    const rows = await rpc<any[]>("nearby_shops", { p_lat: lat, p_lng: lng, p_segment: segment });
    return (rows ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      segment: s.segment,
      address: s.address,
      open: s.open,
      deliveryRupees: s.delivery_paise / 100,
      prepMinutes: s.prep_minutes ?? null,
      km: Number(s.km),
      rating: s.rating == null ? null : Number(s.rating),
      ratings: Number(s.ratings ?? 0),
      items: Number(s.items ?? 0),
      pureVeg: Boolean(s.pure_veg),
      coverUrl: photoUrl(s.cover),
      fromRupees: s.from_paise == null ? null : s.from_paise / 100,
    }));
  },

  async search(lat: number, lng: number, q: string, segment?: Segment): Promise<{ shops: { id: string; name: string; kind: BusinessKind; open: boolean; km: number }[]; items: SearchItem[] }> {
    const r = await rpc<any>("search_nearby", { p_lat: lat, p_lng: lng, p_q: q, p_segment: segment ?? null });
    return {
      shops: (r?.shops ?? []).map((s: any) => ({ id: s.id, name: s.name, kind: s.kind, open: s.open, km: Number(s.km) })),
      items: (r?.items ?? []).map((i: any): SearchItem => ({
        id: i.id,
        name: i.name,
        priceRupees: i.price_paise / 100,
        mrpRupees: i.mrp_paise == null ? null : i.mrp_paise / 100,
        diet: i.diet ?? null,
        quantityLabel: i.quantity ?? null,
        brand: i.brand ?? null,
        photoUrl: photoUrl(i.photo),
        soldOut: Boolean(i.sold_out),
        shopId: i.shop_id,
        shop: i.shop,
        open: i.open,
        km: Number(i.km),
      })),
    };
  },

  async addresses(): Promise<SavedAddress[]> {
    const { data, error } = await need().from("customer_addresses").select("id, label, area, address, lat, lng").order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((a: any) => ({ ...a, lat: Number(a.lat), lng: Number(a.lng) }));
  },

  async saveAddress(address: Omit<SavedAddress, "id"> & { id?: string }): Promise<void> {
    const row = { label: address.label, area: address.area.trim(), address: address.address.trim(), lat: address.lat, lng: address.lng };
    const { error } = address.id
      ? await need().from("customer_addresses").update(row).eq("id", address.id)
      : await need().from("customer_addresses").insert(row);
    if (error) throw new Error(error.message);
  },

  async removeAddress(id: string): Promise<void> {
    const { error } = await need().from("customer_addresses").delete().eq("id", id);
    if (error) throw new Error(error.message);
  },

  async myOrders(): Promise<MyOrder[]> {
    const rows = await rpc<any[]>("my_orders");
    return (rows ?? []).map((o) => ({
      token: o.token,
      code: o.code,
      status: o.status,
      totalRupees: o.total_paise / 100,
      createdAt: o.created_at,
      shop: o.shop,
      shopId: o.shop_id,
      items: Number(o.items),
    }));
  },
};
