import { Capacitor } from "@capacitor/core";
import { BadgeCheck, Download, FileText, Smartphone } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "../components/ui/Button";
import { useT, type TKey } from "../i18n";
import { saveFile } from "../utils/saveFile";
import { BusinessTop, rupees } from "./BusinessScreens";
import {
  PLANS,
  SETUP_FEE,
  type Business,
  type BusinessPlan,
  type Charge,
  type Company,
  type Invoice,
  type Payment,
} from "./BusinessService";
import { invoicePdf } from "./pdf";

const PLAN_NAME: Record<BusinessPlan, TKey> = { starter: "biz_planStarter", growth: "biz_planGrowth", pro: "biz_planPro" };
const PAY_STATUS: Record<Payment["status"], TKey> = { submitted: "bx_paySubmitted", confirmed: "bx_payConfirmed", rejected: "bx_payRejected" };

export function BillingScreen({
  business,
  charges,
  invoices,
  payments,
  company,
  onChangePlan,
  onSubmitPayment,
  nav,
}: {
  business: Business;
  charges: Charge[];
  invoices: Invoice[];
  payments: Payment[];
  company: Company | null;
  onChangePlan: (plan: BusinessPlan) => Promise<void>;
  onSubmitPayment: (amountRupees: number, utr: string, invoiceId?: string) => Promise<void>;
  nav?: ReactNode;
}) {
  const t = useT();
  const [busy, setBusy] = useState<BusinessPlan | null>(null);
  const [error, setError] = useState("");
  const month = new Date().toISOString().slice(0, 7);
  const thisMonth = charges.filter((c) => c.period.startsWith(month));
  const due = charges.filter((c) => c.status === "due").reduce((s, c) => s + c.amountRupees, 0);
  const waiting = payments.filter((p) => p.status === "submitted").reduce((s, p) => s + p.amountRupees, 0);
  const byKind = (k: Charge["kind"]) => thisMonth.filter((c) => c.kind === k).reduce((s, c) => s + c.amountRupees, 0);
  const deliveredThisMonth = thisMonth.filter((c) => c.kind === "routing").length;

  async function choose(plan: BusinessPlan) {
    setBusy(plan);
    setError("");
    try {
      await onChangePlan(plan);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("biz_errGeneric"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="biz-frame biz-frame-wide">
      <BusinessTop business={business}>
        <div className="biz-top-business"><h1>{t("biz_billingTitle")}</h1><p>{t("biz_billingSub")}</p></div>
      </BusinessTop>
      {nav}
      <div className="biz-body">
        <section className="biz-plans">
          {(Object.keys(PLANS) as BusinessPlan[]).map((plan) => {
            const p = PLANS[plan];
            const mine = business.plan === plan;
            return (
              <article key={plan} className={`biz-plan${mine ? " is-mine" : ""}`}>
                <header>
                  <strong>{t(PLAN_NAME[plan])}</strong>
                  {mine ? <span className="biz-plan-tag"><BadgeCheck size={14} /> {t("biz_planCurrent")}</span> : null}
                </header>
                <div className="biz-plan-price">{p.monthly ? t("biz_planMonthly", { price: rupees(p.monthly) }) : t("biz_planFree")}</div>
                <ul>
                  <li>{t("biz_planRouting", { fee: rupees(p.routing) })}</li>
                  {p.adCredit ? <li>{t("biz_planAds", { credit: rupees(p.adCredit) })}</li> : null}
                  {plan === "growth" ? <li className="biz-muted">{t("biz_planBest")}</li> : null}
                </ul>
                {!mine ? (
                  <Button variant={plan === "growth" ? "primary" : "outline"} disabled={busy !== null} onClick={() => void choose(plan)}>
                    {t("biz_planChoose", { plan: t(PLAN_NAME[plan]) })}
                  </Button>
                ) : null}
              </article>
            );
          })}
        </section>
        {error ? <p className="biz-error" role="alert">{error}</p> : null}

        <div className="biz-grid-2">
          <PayCard business={business} due={due} waiting={waiting} invoices={invoices} company={company} onSubmit={onSubmitPayment} />

          <section className="biz-card">
            <div className="biz-card-head"><strong>{t("biz_billThisMonth")}</strong><span className="biz-muted">{new Date().toLocaleDateString([], { month: "long", year: "numeric" })}</span></div>
            <div className="biz-quote">
              <div><span>{t("biz_planRouting", { fee: rupees(PLANS[business.plan].routing) })} × {deliveredThisMonth}</span><strong>{rupees(byKind("routing"))}</strong></div>
              <div><span>{t(PLAN_NAME[business.plan])}</span><strong>{rupees(byKind("plan"))}</strong></div>
              {byKind("setup") ? <div><span>{t("biz_billSetup", { fee: rupees(SETUP_FEE) })}</span><strong>{rupees(byKind("setup"))}</strong></div> : null}
              <div className="biz-total"><span>{t("biz_billDue")}</span><strong>{rupees(due)}</strong></div>
            </div>
            <p className="biz-help">{t("bx_billMonthEnd")}</p>
          </section>
        </div>

        <section className="biz-card">
          <div className="biz-card-head"><strong>{t("bx_invoices")}</strong></div>
          {invoices.length === 0 ? (
            <p className="biz-help">{t("bx_invoicesEmpty")}</p>
          ) : (
            <ul className="biz-invoices">
              {invoices.map((inv) => (
                <li key={inv.id}>
                  <FileText size={18} />
                  <span>
                    <strong>{inv.number}</strong>
                    <small>{new Date(`${inv.period}T00:00:00`).toLocaleDateString([], { month: "long", year: "numeric" })} · {t(inv.status === "paid" ? "bx_invPaid" : "bx_invDue")}</small>
                  </span>
                  <b>{rupees(inv.totalPaise / 100)}</b>
                  <Button variant="ghost" size="sm" onClick={() => void saveFile(`${inv.number.replace(/\//g, "-")}.pdf`, "application/pdf", invoicePdf(inv))}>
                    <Download size={15} /> PDF
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="biz-card">
          <div className="biz-card-head"><strong>{t("bx_payments")}</strong></div>
          {payments.length === 0 ? (
            <p className="biz-help">{t("bx_paymentsEmpty")}</p>
          ) : (
            <ul className="biz-charges">
              {payments.map((p) => (
                <li key={p.id}>
                  <span>UTR {p.utr}<small>{new Date(p.createdAt).toLocaleDateString()} · {t(PAY_STATUS[p.status])}{p.reviewNote ? ` · ${p.reviewNote}` : ""}</small></span>
                  <b>{rupees(p.amountRupees)}</b>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="biz-card">
          <div className="biz-card-head"><strong>{t("biz_billHistory")}</strong></div>
          {charges.length === 0 ? (
            <p className="biz-help">{t("biz_billEmpty")}</p>
          ) : (
            <ul className="biz-charges">
              {charges.slice(0, 60).map((c) => (
                <li key={c.id}>
                  <span>{c.description}<small>{new Date(c.createdAt).toLocaleDateString()} · {t(c.status === "paid" ? "bx_invPaid" : c.status === "waived" ? "bx_waived" : "bx_invDue")}</small></span>
                  <b>{rupees(c.amountRupees)}</b>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function PayCard({
  business,
  due,
  waiting,
  invoices,
  company,
  onSubmit,
}: {
  business: Business;
  due: number;
  waiting: number;
  invoices: Invoice[];
  company: Company | null;
  onSubmit: (amountRupees: number, utr: string, invoiceId?: string) => Promise<void>;
}) {
  const t = useT();
  const open = invoices.filter((i) => i.status === "due");
  const [amount, setAmount] = useState(due ? String(due) : "");
  const [utr, setUtr] = useState("");
  const [invoiceId, setInvoiceId] = useState(open[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const toPay = Math.max(0, due - waiting);
  const upi = company?.upiId;
  const payLink = upi && toPay
    ? `upi://pay?pa=${encodeURIComponent(upi)}&pn=${encodeURIComponent(company?.legalName ?? "Gigzen")}&am=${toPay.toFixed(2)}&cu=INR&tn=${encodeURIComponent(`Waggle Business ${business.name}`.slice(0, 50))}`
    : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSubmit(Number(amount), utr.replace(/\s/g, "").toUpperCase(), invoiceId || undefined);
      setUtr("");
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("biz_errGeneric"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="biz-card biz-pay">
      <div className="biz-card-head"><strong>{t("bx_payTitle")}</strong></div>
      <div className="biz-pay-due">
        <span>{t("bx_payDue")}</span>
        <b>{rupees(toPay)}</b>
        {waiting ? <small>{t("bx_payWaiting", { amount: rupees(waiting) })}</small> : null}
      </div>
      {upi ? (
        <>
          <p className="biz-help">{t("bx_payTo", { upi })}</p>
          {payLink && (Capacitor.isNativePlatform() || /Android|iPhone|iPad/i.test(navigator.userAgent)) ? (
            <a className="biz-button-link" href={payLink}><Smartphone size={16} /> {t("bx_payUpiApp", { amount: rupees(toPay) })}</a>
          ) : payLink ? (
            <p className="biz-note">{t("bx_payFromPhone", { upi, amount: rupees(toPay) })}</p>
          ) : null}
        </>
      ) : (
        <p className="biz-note">{t("bx_payNoUpi")}</p>
      )}
      <form className="biz-pay-form" onSubmit={submit}>
        <div className="biz-row">
          <label className="biz-field"><span>{t("bx_payAmount")}</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" placeholder="999" />
          </label>
          <label className="biz-field"><span>{t("bx_payUtr")}</span>
            <input value={utr} onChange={(e) => setUtr(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, ""))} placeholder="412345678901" maxLength={22} />
          </label>
        </div>
        {open.length ? (
          <label className="biz-field"><span>{t("bx_payFor")}</span>
            <select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
              <option value="">{t("bx_payOldest")}</option>
              {open.map((i) => <option key={i.id} value={i.id}>{i.number} · {rupees(i.totalPaise / 100)}</option>)}
            </select>
          </label>
        ) : null}
        <p className="biz-help">{t("bx_payUtrHelp")}</p>
        {error ? <p className="biz-error" role="alert">{error}</p> : null}
        {sent ? <p className="biz-ok" role="status">{t("bx_paySent")}</p> : null}
        <Button type="submit" variant="outline" disabled={busy || !utr || !Number(amount)}>{t("bx_paySubmit")}</Button>
      </form>
    </section>
  );
}
