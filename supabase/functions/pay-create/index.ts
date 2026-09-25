// Supabase Edge Function: pay-create
// A customer asks to pay an order online. The amount and the shop's share are
// read from the database (payments_v1.sql), never taken from the app; the
// Razorpay order carries a Route transfer of the shop's share to the shop's
// linked account. Returns what Razorpay Checkout needs to open.

import { admin, cors, json, razorpay } from "../_shared/razorpay.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const keyId = Deno.env.get("RAZORPAY_KEY_ID");
  if (!keyId || !Deno.env.get("RAZORPAY_KEY_SECRET")) return json({ error: "not_configured" }, 503);

  const { token } = await req.json().catch(() => ({}));
  if (typeof token !== "string" || token.length !== 36) return json({ error: "bad_request" }, 400);

  const db = admin();
  const { data: p, error } = await db.rpc("_payment_prepare", { p_token: token });
  if (error) return json({ error: "server" }, 500);
  if (p?.error) return json({ error: p.error }, 409);

  try {
    const order = await razorpay("/v1/orders", {
      amount: p.amount_paise,
      currency: "INR",
      receipt: p.code,
      notes: { waggle_order: p.order_id },
      transfers: [{ account: p.account, amount: p.shop_paise, currency: "INR", notes: { waggle_order: p.order_id }, on_hold: false }],
    });
    const { error: saveError } = await db.rpc("_payment_created", {
      p_order: p.order_id, p_rzp_order: order.id, p_amount: p.amount_paise, p_shop: p.shop_paise,
    });
    if (saveError) return json({ error: "server" }, 500);
    return json({
      key: keyId, order_id: order.id, amount: p.amount_paise, currency: "INR",
      name: "Waggle", description: `${p.shop} · order ${p.code}`, phone: p.phone,
    });
  } catch (err) {
    console.error(err);
    return json({ error: "gateway" }, 502);
  }
});
