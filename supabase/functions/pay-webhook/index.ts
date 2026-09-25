// Supabase Edge Function: pay-webhook
// Razorpay's own word that a payment went through, for when the customer's app
// closed before it could report back. Set it up in Razorpay: Settings >
// Webhooks > URL https://<project>.supabase.co/functions/v1/pay-webhook,
// events payment.captured and order.paid, and the same secret as
// RAZORPAY_WEBHOOK_SECRET. Deployed with --no-verify-jwt (Razorpay sends no
// Supabase token); the signature over the raw body is the check instead.

import { admin, hmacHex, sameHex } from "../_shared/razorpay.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const secret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET");
  if (!secret) return new Response("not configured", { status: 503 });

  const raw = await req.text();
  const signature = req.headers.get("x-razorpay-signature") ?? "";
  if (!sameHex(await hmacHex(secret, raw), signature)) return new Response("bad signature", { status: 400 });

  let event: any;
  try { event = JSON.parse(raw); } catch { return new Response("bad body", { status: 400 }); }
  if (event?.event !== "payment.captured" && event?.event !== "order.paid") return new Response("ignored", { status: 200 });

  const payment = event?.payload?.payment?.entity;
  if (!payment?.order_id || !payment?.id) return new Response("no payment", { status: 200 });
  const { error } = await admin().rpc("_payment_paid", { p_rzp_order: payment.order_id, p_rzp_payment: payment.id });
  // A failure here makes Razorpay retry, which is what we want.
  if (error) return new Response("retry", { status: 500 });
  return new Response("ok", { status: 200 });
});
