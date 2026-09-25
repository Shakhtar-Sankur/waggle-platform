// Shared by pay-create, pay-verify and pay-webhook.
//
// Secrets (supabase secrets set ...; never in the app):
//   RAZORPAY_KEY_ID          rzp_test_... or rzp_live_... (the key id is public)
//   RAZORPAY_KEY_SECRET      the key secret
//   RAZORPAY_WEBHOOK_SECRET  the secret typed into the Razorpay webhook settings
//   RAZORPAY_API             optional, defaults to https://api.razorpay.com (a local stand-in for tests)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

export function admin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compares two hex strings without leaking where they differ. */
export function sameHex(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function razorpay(path: string, body: unknown) {
  const id = Deno.env.get("RAZORPAY_KEY_ID")!, secret = Deno.env.get("RAZORPAY_KEY_SECRET")!;
  const base = Deno.env.get("RAZORPAY_API") ?? "https://api.razorpay.com";
  const r = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${id}:${secret}`)}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Razorpay ${r.status}: ${data?.error?.description ?? "request failed"}`);
  return data;
}
