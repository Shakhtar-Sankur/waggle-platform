import { supabase } from "./SupabaseService";

/** Online payment for shop orders (supabase/payments_v1.sql and the pay-* Edge Functions). */

export interface PayStatus {
  available: boolean;
  paid: boolean;
  paidAt: string | null;
  amount: number;
}

export interface AdminOnlinePay {
  live: boolean;
  feeBps: number;
  shops: { id: string; name: string; account: string | null }[];
  paid30d: number;
}

interface CheckoutOrder {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  phone?: string;
}

declare global {
  interface Window { Razorpay?: new (options: Record<string, unknown>) => { open: () => void; on: (event: string, fn: (r: any) => void) => void } }
}

function need() {
  if (!supabase) throw new Error("Waggle needs a connection to the server.");
  return supabase;
}

const MESSAGES: Record<string, string> = {
  not_available: "Online payment is not available for this order.",
  already_paid: "This order is already paid.",
  not_payable: "This order can no longer be paid online.",
  not_found: "Order not found.",
  not_configured: "Online payment is not set up yet.",
  gateway: "The payment service did not answer. Try again, or pay on delivery.",
};

async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await need().functions.invoke(name, { body });
  if (error) {
    let code = "";
    try { code = (await (error as any).context?.json?.())?.error ?? ""; } catch { /* no body */ }
    throw new Error(MESSAGES[code] ?? "Payment failed. Try again.");
  }
  return data as T;
}

/** Razorpay's checkout script, loaded once, only when someone pays. */
function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load the payment page. Check your connection."));
    document.head.appendChild(s);
  });
}

export const PaymentService = {
  async status(token: string): Promise<PayStatus | null> {
    const { data, error } = await need().rpc("online_pay_status", { p_token: token });
    if (error || !data) return null;
    return { available: Boolean(data.available), paid: Boolean(data.paid), paidAt: data.paid_at ?? null, amount: Number(data.amount ?? 0) };
  },

  /**
   * Opens Razorpay Checkout for this order. Resolves true once the payment is
   * verified on the server, false if the customer closed the window.
   */
  async payOrder(token: string): Promise<boolean> {
    const order = await invoke<CheckoutOrder>("pay-create", { token });
    await loadCheckout();
    return new Promise((resolve, reject) => {
      const rzp = new window.Razorpay!({
        key: order.key,
        order_id: order.order_id,
        amount: order.amount,
        currency: order.currency,
        name: order.name,
        description: order.description,
        prefill: order.phone ? { contact: order.phone } : undefined,
        theme: { color: "#4F46E5" },
        handler: (r: Record<string, string>) => {
          invoke("pay-verify", r).then(() => resolve(true)).catch(reject);
        },
        modal: { ondismiss: () => resolve(false) },
      });
      rzp.on("payment.failed", (r) => reject(new Error(r?.error?.description ?? "The payment did not go through.")));
      rzp.open();
    });
  },

  async jobPayment(jobId: string): Promise<{ amount: number; paidOnline: boolean } | null> {
    const { data, error } = await need().rpc("job_order_payment", { p_job: jobId });
    if (error || !data) return null;
    return { amount: Number(data.amount), paidOnline: Boolean(data.paid_online) };
  },

  async adminView(): Promise<AdminOnlinePay> {
    const { data, error } = await need().rpc("admin_online_pay_view");
    if (error) throw new Error(error.message);
    return { live: Boolean(data.live), feeBps: Number(data.fee_bps), shops: data.shops ?? [], paid30d: Number(data.paid_30d ?? 0) };
  },

  async adminSet(live: boolean, feePercent?: number): Promise<void> {
    const { error } = await need().rpc("admin_online_pay", { p_live: live, p_fee_bps: feePercent == null ? null : Math.round(feePercent * 100) });
    if (error) throw new Error(error.message);
  },

  async adminSetAccount(businessId: string, account: string): Promise<void> {
    const { error } = await need().rpc("admin_set_razorpay_account", { p_business: businessId, p_account: account });
    if (error) throw new Error(/check constraint/i.test(error.message) ? "A Razorpay linked account id looks like acc_XXXXXXXX." : error.message);
  },
};
