import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { Bike, CalendarClock, Check, Copy, Link2, Phone, ShoppingBag, Star, Store, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Button } from "../components/ui/Button";
import { useT, type TKey } from "../i18n";
import { BusinessTop, rupees } from "./BusinessScreens";
import { photoUrl, shopLink, type Business, type Order, type OrderStatus } from "./BusinessService";

const ORDER_STATUS: Record<OrderStatus, TKey> = {
  placed: "bx_ordPlaced",
  accepted: "bx_ordAccepted",
  rejected: "bx_ordRejected",
  dispatched: "bx_ordDispatched",
  delivered: "bx_ordDelivered",
  cancelled: "bx_ordCancelled",
};

/** The customer's problem kinds, to the label suffix the Waggle app uses. */
const ISSUE_KEY: Record<string, string> = {
  late: "Late", missing_item: "Missing", wrong_item: "Wrong", damaged: "Damaged", rider: "Rider", payment: "Payment", other: "Other",
};

type Tab = "new" | "active" | "done";

export function OrdersScreen({
  business,
  orders,
  onRespond,
  onDispatch,
  onSelfDelivered,
  onCancel,
  onSettings,
  onReply,
  nav,
}: {
  business: Business;
  orders: Order[];
  onRespond: (id: string, accept: boolean, reason?: string) => Promise<void>;
  onDispatch: (id: string) => Promise<void>;
  onSelfDelivered: (id: string) => Promise<void>;
  onCancel: (id: string, reason: string) => Promise<void>;
  onSettings: (settings: { shopOpen: boolean; deliveryChargeRupees: number; prepMinutes: number | null }) => Promise<void>;
  onReply: (id: string, reply: string) => Promise<void>;
  nav?: ReactNode;
}) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("new");
  const groups = useMemo(() => ({
    new: orders.filter((o) => o.status === "placed"),
    active: orders.filter((o) => o.status === "accepted" || o.status === "dispatched"),
    done: orders.filter((o) => o.status === "delivered" || o.status === "rejected" || o.status === "cancelled"),
  }), [orders]);
  const shown = groups[tab];

  return (
    <div className="biz-frame biz-frame-wide">
      <BusinessTop business={business}>
        <div className="biz-top-business"><h1>{t("bx_ordersTitle")}</h1><p>{t("bx_ordersSub")}</p></div>
      </BusinessTop>
      {nav}
      <div className="biz-columns">
        <aside className="biz-side biz-side-always">
          <div className="biz-body">
            <ShopLinkCard business={business} onSettings={onSettings} />
          </div>
        </aside>
        <div className="biz-body">
          <div className="biz-tabs" role="tablist">
            {(["new", "active", "done"] as Tab[]).map((key) => (
              <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? "is-on" : ""} onClick={() => setTab(key)}>
                {t(key === "new" ? "bx_ordTabNew" : key === "active" ? "bx_ordTabActive" : "bx_ordTabDone")}
                {groups[key].length && key !== "done" ? <span className="biz-count">{groups[key].length}</span> : null}
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <section className="biz-card"><div className="biz-empty"><ShoppingBag size={22} /><p>{t(tab === "new" ? "bx_ordEmptyNew" : "bx_ordEmpty")}</p></div></section>
          ) : (
            shown.map((order) => (
              <OrderCard key={order.id} order={order} onRespond={onRespond} onDispatch={onDispatch} onSelfDelivered={onSelfDelivered} onCancel={onCancel} onReply={onReply} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function ShopLinkCard({ business, onSettings }: { business: Business; onSettings: (s: { shopOpen: boolean; deliveryChargeRupees: number; prepMinutes: number | null }) => Promise<void> }) {
  const t = useT();
  const link = shopLink(business.id);
  const [copied, setCopied] = useState(false);
  const [charge, setCharge] = useState(String(business.deliveryChargeRupees));
  const [prep, setPrep] = useState(business.prepMinutes == null ? "" : String(business.prepMinutes));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function share() {
    if (!link) return;
    const text = t("bx_shareText", { name: business.name });
    if (Capacitor.isNativePlatform()) {
      await Share.share({ title: business.name, text, url: link });
    } else if (navigator.share) {
      await navigator.share({ title: business.name, text, url: link }).catch(() => undefined);
    } else {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    }
  }

  async function save(shopOpen: boolean) {
    const value = Number(charge || 0);
    if (!Number.isFinite(value) || value < 0 || value > 500) {
      setError(t("bx_chargeErr"));
      return;
    }
    const minutes = prep ? Number(prep) : null;
    if (minutes != null && (minutes < 5 || minutes > 120)) {
      setError(t("bx_prepErr"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSettings({ shopOpen, deliveryChargeRupees: value, prepMinutes: minutes });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("biz_errGeneric"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="biz-card biz-shoplink">
      <div className="biz-card-head"><strong><Store size={16} /> {t("bx_shopLinkTitle")}</strong></div>
      {link ? (
        <>
          <p className="biz-help">{t("bx_shopLinkSub")}</p>
          <a className="biz-linkbox" href={link} target="_blank" rel="noreferrer"><Link2 size={15} /> {link}</a>
          <div className="biz-decide">
            <Button variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(link).then(() => setCopied(true))}>
              {copied ? <Check size={15} /> : <Copy size={15} />} {t(copied ? "bx_copied" : "bx_copy")}
            </Button>
            <Button size="sm" onClick={() => void share()}>{t("bx_share")}</Button>
          </div>
        </>
      ) : (
        <p className="biz-help">{t("bx_shopLinkWeb")}</p>
      )}
      <label className="biz-switch">
        <input type="checkbox" checked={business.shopOpen} disabled={busy} onChange={(e) => void save(e.target.checked)} />
        <span>{t(business.shopOpen ? "bx_shopOpen" : "bx_shopClosed")}</span>
      </label>
      <div className="biz-row biz-row-end">
        <label className="biz-field"><span>{t("bx_deliveryCharge")}</span>
          <input value={charge} onChange={(e) => setCharge(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" placeholder="0" />
        </label>
        <label className="biz-field"><span>{t("bx_prepTime")}</span>
          <input value={prep} onChange={(e) => setPrep(e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="15" />
        </label>
      </div>
      <Button variant="outline" disabled={busy || (Number(charge || 0) === business.deliveryChargeRupees && (prep ? Number(prep) : null) === business.prepMinutes)}
        onClick={() => void save(business.shopOpen)}>{t("biz_save")}</Button>
      <p className="biz-help">{t("bx_deliveryChargeHelp")}</p>
      {error ? <p className="biz-error" role="alert">{error}</p> : null}
    </section>
  );
}

function OrderCard({
  order,
  onRespond,
  onDispatch,
  onSelfDelivered,
  onCancel,
  onReply,
}: {
  order: Order;
  onRespond: (id: string, accept: boolean, reason?: string) => Promise<void>;
  onDispatch: (id: string) => Promise<void>;
  onSelfDelivered: (id: string) => Promise<void>;
  onCancel: (id: string, reason: string) => Promise<void>;
  onReply: (id: string, reply: string) => Promise<void>;
}) {
  const t = useT();
  const [reason, setReason] = useState("");
  const [reply, setReply] = useState(order.review?.reply ?? "");
  const [asking, setAsking] = useState<"reject" | "cancel" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      setAsking(null);
      setReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("biz_errGeneric"));
    } finally {
      setBusy(false);
    }
  }

  const when = new Date(order.createdAt);
  return (
    <section className={`biz-card biz-order is-${order.status}`}>
      <div className="biz-card-head">
        <strong>{t("bx_orderCode", { code: order.code })}</strong>
        <span className={`biz-status biz-ord-${order.status}`}>{t(ORDER_STATUS[order.status])}</span>
      </div>
      {order.scheduledFor ? (
        <p className="biz-scheduled"><CalendarClock size={15} /> {t("bx_scheduledFor", { when: new Date(order.scheduledFor).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) })}</p>
      ) : null}
      <p className="biz-order-when">{when.toLocaleDateString([], { day: "numeric", month: "short" })} · {when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p>
      <ul className="biz-order-items">
        {order.items.map((line, i) => (
          <li key={`${line.id}-${i}`}>
            <span>{line.qty} × {line.name}{line.options.length ? <small className="biz-line-opts">{line.options.map((o) => o.choice).join(", ")}</small> : null}</span>
            <b>{rupees(line.qty * line.priceRupees)}</b>
          </li>
        ))}
        {order.discountRupees ? <li className="biz-discount"><span>{t("bx_couponLine", { code: order.couponCode ?? "" })}</span><b>−{rupees(order.discountRupees)}</b></li> : null}
        {order.deliveryRupees ? <li className="biz-muted"><span>{t("bx_deliveryLine")}</span><b>{rupees(order.deliveryRupees)}</b></li> : null}
        <li className="biz-total"><span>{t("bx_totalCash")}</span><b>{rupees(order.totalRupees)}</b></li>
      </ul>
      <div className="biz-order-customer">
        <div>
          <strong>{order.customerName}</strong>
          <span>{order.area} · {order.address}</span>
          {order.note ? <em>“{order.note}”</em> : null}
        </div>
        <a className="biz-icon-link" href={`tel:${order.customerPhone}`} aria-label={t("bx_call", { name: order.customerName })}><Phone size={17} /></a>
      </div>
      {order.reason && (order.status === "rejected" || order.status === "cancelled") ? <p className="biz-help">{order.reason}</p> : null}
      {order.review ? (
        <div className="biz-review-box">
          <p className="biz-order-review"><Star size={14} fill="currentColor" /> {t("bx_ordRated", { stars: String(order.review.stars) })}{order.review.comment ? ` · “${order.review.comment}”` : ""}</p>
          {order.review.photo_path ? <img src={photoUrl(order.review.photo_path, "review-photos") ?? ""} alt="" /> : null}
          <div className="biz-row biz-row-end">
            <label className="biz-field"><span>{t("bx_replyLabel")}</span>
              <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder={t("bx_replyPh")} maxLength={300} />
            </label>
            <Button variant="outline" size="sm" disabled={busy || reply.trim().length < 2 || reply === order.review.reply} onClick={() => void run(() => onReply(order.id, reply))}>
              {t(order.review.reply ? "bx_replyUpdate" : "bx_replySend")}
            </Button>
          </div>
        </div>
      ) : null}
      {order.issues.length ? (
        <p className="biz-error">{t("bx_ordIssues", { list: order.issues.map((i) => `${t(`wg_issue${ISSUE_KEY[i.kind] ?? "Other"}` as TKey)}${i.details ? ` (${i.details})` : ""}`).join("; ") })}</p>
      ) : null}

      {asking ? (
        <div className="biz-order-ask">
          <label className="biz-field"><span>{t("bx_reasonLabel")}</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("bx_reasonPh")} maxLength={200} autoFocus />
          </label>
          <div className="biz-decide">
            <Button variant="outline" disabled={busy || reason.trim().length < 3}
              onClick={() => void run(() => (asking === "reject" ? onRespond(order.id, false, reason) : onCancel(order.id, reason)))}>
              {t(asking === "reject" ? "bx_rejectConfirm" : "bx_cancelConfirm")}
            </Button>
            <Button variant="ghost" onClick={() => setAsking(null)}>{t("biz_back")}</Button>
          </div>
        </div>
      ) : order.status === "placed" ? (
        <div className="biz-decide">
          <Button disabled={busy} onClick={() => void run(() => onRespond(order.id, true))}><Check size={16} /> {t("bx_accept")}</Button>
          <Button variant="outline" disabled={busy} onClick={() => setAsking("reject")}><X size={16} /> {t("bx_reject")}</Button>
        </div>
      ) : order.status === "accepted" ? (
        <div className="biz-decide">
          <Button disabled={busy} onClick={() => void run(() => onDispatch(order.id))}><Bike size={16} /> {t("bx_sendWaggle")}</Button>
          <Button variant="outline" disabled={busy} onClick={() => void run(() => onSelfDelivered(order.id))}>{t("bx_selfDelivered")}</Button>
          <Button variant="ghost" disabled={busy} onClick={() => setAsking("cancel")}>{t("bx_cancelOrder")}</Button>
        </div>
      ) : order.status === "dispatched" ? (
        <p className="biz-help">{t("bx_dispatchedHelp")}</p>
      ) : null}
      {error ? <p className="biz-error" role="alert">{error}</p> : null}
    </section>
  );
}
