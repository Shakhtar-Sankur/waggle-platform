// Supabase Edge Function: pay-verify
// Right after Razorpay Checkout succeeds, the app sends what Razorpay gave it.
// The payment counts only if Razorpay's signature over "order_id|payment_id"
// matches with the key secret, which the app never has.

import { admin, cors, hmacHex, json, sameHex } from "../_shared/razorpay.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const secret = Deno.env.get("RAZORPAY_KEY_SECRET");
  if (!secret) return json({ error: "not_configured" }, 503);

  const b = await req.json().catch(() => ({}));
  const orderId = b?.razorpay_order_id, paymentId = b?.razorpay_payment_id, signature = b?.razorpay_signature;
  if (![orderId, paymentId, signature].every((v) => typeof v === "string" && v.length > 0 && v.length < 200)) {
    return json({ error: "bad_request" }, 400);
  }
  if (!sameHex(await hmacHex(secret, `${orderId}|${paymentId}`), signature)) {
    return json({ error: "bad_signature" }, 400);
  }
  const { data, error } = await admin().rpc("_payment_paid", { p_rzp_order: orderId, p_rzp_payment: paymentId });
  if (error) return json({ error: "server" }, 500);
  if (data === "unknown_order") return json({ error: "unknown_order" }, 404);
  return json({ ok: true, result: data });
});
