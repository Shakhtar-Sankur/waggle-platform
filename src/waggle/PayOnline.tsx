import { BadgeCheck, CreditCard } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useT } from "../i18n";
import { PaymentService, type PayStatus } from "../services/PaymentService";
import { rupees } from "./common";

/**
 * On the order's tracking page: pay the shop online now (UPI, card,
 * netbanking) through Razorpay, or keep paying on delivery. Shown only once
 * Gigzen has switched online payment on and the shop has a linked account.
 */
export function PayOnline({ token, active, onPaid }: { token: string; active: boolean; onPaid?: (paid: boolean) => void }) {
  const t = useT();
  const [status, setStatus] = useState<PayStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    void PaymentService.status(token).then((s) => { setStatus(s); onPaid?.(Boolean(s?.paid)); }).catch(() => undefined);
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load, active]);

  if (!status) return null;
  if (status.paid) {
    return <section className="wg-card wg-paid" role="status"><BadgeCheck size={20} /><span><strong>{t("pay_paidTitle", { amount: rupees(status.amount) })}</strong><small>{t("pay_paidSub")}</small></span></section>;
  }
  if (!status.available || !active) return null;

  async function pay() {
    setBusy(true);
    setError("");
    try {
      if (await PaymentService.payOrder(token)) load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("biz_errGeneric"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="wg-card wg-payonline">
      <div>
        <strong><CreditCard size={17} /> {t("pay_title", { amount: rupees(status.amount) })}</strong>
        <small>{t("pay_sub")}</small>
      </div>
      {error ? <p className="wg-error" role="alert">{error}</p> : null}
      <button type="button" className="wg-btn wg-btn-primary wg-btn-block" disabled={busy} onClick={() => void pay()}>
        {busy ? t("pay_opening") : t("pay_button", { amount: rupees(status.amount) })}
      </button>
    </section>
  );
}
