import { AlertTriangle, BadgeCheck, Bike, CalendarClock, Camera, Check, ChefHat, Clock3, MapPin, PackageCheck, Phone, RotateCcw, Search, ShoppingBag, Star, Store, X } from "lucide-react";
import { useRef, useEffect, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { useT, type TKey } from "../i18n";
import { useAuthStore } from "../stores/useAuthStore";
import { shrinkImage } from "../utils/shrinkImage";
import { BusinessService, type TrackedOrder } from "../business/BusinessService";
import { clock, dayAndTime, minutesBetween, rememberOrder, rupees, setReorder, WgFrame } from "./common";
import { TrackMap } from "./TrackMap";
import { RateRider, RiderAverage, useDeliveryRating } from "./RateRider";
import { PayOnline } from "./PayOnline";

const VEHICLE: Record<string, TKey> = {
  bike: "wg_vBike", scooter: "wg_vScooter", ev_scooter: "wg_vEv", auto: "wg_vAuto", car: "wg_vCar", bicycle: "wg_vBicycle", on_foot: "wg_vFoot",
};
const ISSUES: { id: string; label: TKey }[] = [
  { id: "late", label: "wg_issueLate" },
  { id: "missing_item", label: "wg_issueMissing" },
  { id: "wrong_item", label: "wg_issueWrong" },
  { id: "damaged", label: "wg_issueDamaged" },
  { id: "rider", label: "wg_issueRider" },
  { id: "payment", label: "wg_issuePayment" },
  { id: "other", label: "wg_issueOther" },
];

type Stage = "placed" | "accepted" | "finding" | "to_shop" | "on_way" | "delivered" | "rejected" | "cancelled";

function stageOf(o: TrackedOrder): Stage {
  if (o.status === "dispatched") {
    if (o.job?.status === "picked_up") return "on_way";
    if (o.job?.status === "accepted") return "to_shop";
    return "finding";
  }
  return o.status as Stage;
}

export function TrackPage() {
  const t = useT();
  const { token = "" } = useParams();
  const [order, setOrder] = useState<TrackedOrder | null | undefined>(undefined);
  const [eta, setEta] = useState<number | null>(null);
  const stage = order ? stageOf(order) : null;
  const [riderRating, reloadRating] = useDeliveryRating(token, stage === "delivered");
  const [paidOnline, setPaidOnline] = useState(false);
  // "Your rider is about 2 minutes away": once, with a buzz, so the customer can come to the door.
  const nearTold = useRef(false);
  const near = stage === "on_way" && eta != null && eta <= 3;
  useEffect(() => {
    if (!near || nearTold.current) return;
    nearTold.current = true;
    try { navigator.vibrate?.([180, 80, 180]); } catch { /* no vibration */ }
  }, [near]);

  useEffect(() => {
    let live = true;
    const load = () =>
      BusinessService.trackOrder(token)
        .then((o) => {
          if (!live) return;
          setOrder(o);
          if (o) rememberOrder({ token, code: o.code, shop: o.shop.name, shopId: o.shop.id, at: o.createdAt });
        })
        .catch(() => live && setOrder((prev) => prev ?? null));
    void load();
    // Faster while a rider is moving, so the map keeps up.
    const timer = window.setInterval(load, stage === "on_way" || stage === "to_shop" ? 8000 : 15000);
    return () => { live = false; window.clearInterval(timer); };
  }, [token, stage]);

  if (order === undefined) return <WgFrame><p className="wg-loading">{t("biz_loading")}</p></WgFrame>;
  if (order === null || !stage) {
    return (
      <WgFrame>
        <main className="wg-page">
          <section className="wg-card wg-empty"><ShoppingBag size={28} /><h2>{t("wg_trackMissing")}</h2><p>{t("wg_trackMissingSub")}</p></section>
        </main>
      </WgFrame>
    );
  }

  const shop = order.shop.name;
  const rider = order.rider?.firstName ?? t("wg_yourRider");
  const deliveredAt = order.deliveredAt ?? order.job?.deliveredAt ?? null;
  const hero: Record<Stage, { icon: ReactNode; title: string; sub: string; tone: string }> = {
    placed: { icon: <Clock3 size={26} />, title: t("wg_tPlaced", { shop }), sub: t("wg_sPlaced"), tone: "waiting" },
    accepted: { icon: <ChefHat size={26} />, title: t("wg_tAccepted", { shop }), sub: t("wg_sAccepted"), tone: "active" },
    finding: { icon: <Search size={26} />, title: t("wg_tFinding", { shop }), sub: t("wg_sFinding"), tone: "active" },
    to_shop: { icon: <Store size={26} />, title: t("wg_tToShop", { rider, shop }), sub: t("wg_sToShop"), tone: "active" },
    on_way: { icon: <Bike size={26} />, title: t("wg_tOnWay", { rider }), sub: eta ? t("wg_sEta", { min: String(eta) }) : t("wg_sOnWay"), tone: "active" },
    delivered: {
      icon: <PackageCheck size={26} />,
      title: deliveredAt ? t("wg_tDelivered", { time: clock(deliveredAt) }) : t("wg_stepDelivered"),
      sub: deliveredAt ? (minutesBetween(order.createdAt, deliveredAt) === 1 ? t("wg_sDeliveredOne") : t("wg_sDelivered", { min: String(minutesBetween(order.createdAt, deliveredAt)) })) : "",
      tone: "done",
    },
    rejected: { icon: <X size={26} />, title: t("wg_tRejected", { shop }), sub: order.reason ?? t("wg_sNoCharge"), tone: "stopped" },
    cancelled: { icon: <X size={26} />, title: t("wg_tCancelled"), sub: order.reason ?? t("wg_sNoCharge"), tone: "stopped" },
  };
  const h = hero[stage];
  const active = stage !== "delivered" && stage !== "rejected" && stage !== "cancelled";

  return (
    <WgFrame bar={<span className="wg-ordercode">#{order.code}</span>}>
      <main className="wg-page">
        <section className={`wg-hero is-${h.tone}`} aria-live="polite">
          <span className="wg-hero-icon">{h.icon}</span>
          <div>
            <h1>{h.title}</h1>
            {h.sub ? <p>{h.sub}</p> : null}
          </div>
          {stage === "on_way" && eta ? <div className="wg-eta"><b>{eta}</b><span>{t("wg_min")}</span></div> : null}
        </section>

        {near ? (
          <section className="wg-card wg-near" role="status">
            <Bike size={20} />
            <span><strong>{t("wg_nearTitle", { rider })}</strong><small>{t("wg_nearSub")}</small></span>
          </section>
        ) : null}

        {order.scheduledFor && (stage === "placed" || stage === "accepted") ? (
          <section className="wg-card wg-scheduled">
            <CalendarClock size={20} />
            <span><strong>{t("wg_scheduledFor", { when: dayAndTime(order.scheduledFor) })}</strong><small>{t("wg_scheduledSub", { shop })}</small></span>
          </section>
        ) : null}

        <PayOnline token={token} active={active} onPaid={setPaidOnline} />

        {order.status === "dispatched" && order.deliveryCode ? (
          <section className="wg-card wg-code">
            <div>
              <span>{t("wg_codeTitle")}</span>
              <small>{t("wg_codeHelp")}</small>
            </div>
            <b aria-label={order.deliveryCode.split("").join(" ")}>{order.deliveryCode}</b>
          </section>
        ) : null}

        {active ? (
          <section className="wg-card wg-mapcard">
            <TrackMap
              shop={{ lat: order.shop.lat, lng: order.shop.lng }}
              drop={{ lat: order.lat, lng: order.lng }}
              rider={stage === "on_way" && order.riderAt ? { lat: order.riderAt.lat, lng: order.riderAt.lng } : null}
              labels={{ shop, drop: t("wg_you"), rider }}
              // A minute for parking and the handover on top of the riding time left.
              onRoute={(r) => setEta(r ? r.minutes + 1 : null)}
            />
            {stage === "on_way" && !order.riderAt ? <p className="wg-fine">{t("wg_riderQuiet")}</p> : null}
          </section>
        ) : null}

        {order.rider && (stage === "to_shop" || stage === "on_way" || stage === "delivered") ? (
          <section className="wg-card wg-rider">
            <span className="wg-avatar" aria-hidden>{order.rider.firstName.slice(0, 1).toUpperCase()}</span>
            <div>
              <strong>{order.rider.firstName} <RiderAverage rating={riderRating} /></strong>
              <span>{t(VEHICLE[order.rider.vehicle] ?? "wg_vBike")}{order.rider.plateLast4 ? ` · ••${order.rider.plateLast4}` : ""}</span>
              <small><BadgeCheck size={13} /> {t("wg_riderVerified")}</small>
            </div>
          </section>
        ) : null}

        <Timeline order={order} stage={stage} />

        {stage === "delivered" && order.rider ? <RateRider token={token} via="order" rider={rider} rating={riderRating} onDone={reloadRating} /> : null}
        {stage === "delivered" ? <AfterDelivery order={order} token={token} /> : null}

        <Receipt order={order} paidOnline={paidOnline} />

        <div className="wg-help">
          {order.shop.phone ? <a className="wg-btn wg-btn-soft" href={`tel:${order.shop.phone}`}><Phone size={16} /> {t("wg_callShop")}</a> : null}
          {order.status === "placed" ? <CancelButton token={token} onDone={setOrder} /> : null}
        </div>
        <p className="wg-fine wg-center">{t("wg_privacy")}</p>
      </main>
    </WgFrame>
  );
}

/** How far along an order is: 0 placed, 1 accepted, 2 rider on it, 3 picked up, 4 delivered. */
const REACHED: Record<Stage, number> = { placed: 0, accepted: 1, finding: 1, to_shop: 2, on_way: 3, delivered: 4, rejected: 0, cancelled: 0 };

function Timeline({ order, stage }: { order: TrackedOrder; stage: Stage }) {
  const t = useT();
  const stopped = stage === "rejected" || stage === "cancelled";
  const reached = REACHED[stage];
  const steps: { label: string; at: string | null }[] = stopped
    ? [
        { label: t("wg_stepPlaced"), at: order.createdAt },
        { label: t(stage === "rejected" ? "wg_stepRejected" : "wg_stepCancelled"), at: order.closedAt },
      ]
    : [
        { label: t("wg_stepPlaced"), at: order.createdAt },
        { label: t("wg_stepAccepted", { shop: order.shop.name }), at: order.acceptedAt },
        { label: order.rider ? t("wg_stepRider", { rider: order.rider.firstName }) : t("wg_stepRiderPending"), at: order.job?.acceptedAt ?? null },
        { label: t("wg_stepPickedUp"), at: order.job?.pickedUpAt ?? null },
        { label: t("wg_stepDelivered"), at: order.deliveredAt ?? order.job?.deliveredAt ?? null },
      ];
  return (
    <section className="wg-card">
      <h2 className="wg-h2">{t("wg_progress")}</h2>
      <ol className="wg-steps">
        {steps.map((s, i) => {
          // A step is done once the order is past it, even if an older order has no time for it.
          const done = stopped ? true : i <= reached;
          const now = !stopped && i === reached + 1;
          return (
            <li key={i} className={done ? "is-done" : now ? "is-now" : ""}>
              <span className="wg-dot">{done ? <Check size={13} /> : null}</span>
              <span className="wg-step-label">{s.label}</span>
              <time>{done && s.at ? clock(s.at) : now ? t("wg_now") : ""}</time>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Receipt({ order, paidOnline }: { order: TrackedOrder; paidOnline: boolean }) {
  const t = useT();
  const count = order.items.reduce((s, l) => s + l.qty, 0);
  return (
    <section className="wg-card wg-receipt">
      <header>
        <div>
          <strong>{order.shop.name}</strong>
          <small>{order.shop.address}</small>
          {order.shop.gstin ? <small>GSTIN {order.shop.gstin}</small> : null}
        </div>
        <div className="wg-receipt-meta">
          <b>#{order.code}</b>
          <small>{dayAndTime(order.createdAt)}</small>
        </div>
      </header>
      <ul>
        {order.items.map((l, i) => (
          <li key={`${l.id}-${i}`}>
            <span><i>{l.qty}×</i> {l.name}{l.options.length ? <small className="wg-line-opts">{l.options.map((o) => o.choice).join(", ")}</small> : null}</span>
            <b>{rupees(l.qty * l.priceRupees)}</b>
          </li>
        ))}
      </ul>
      <dl>
        <div><dt>{t("wg_itemTotal", { count: String(count) })}</dt><dd>{rupees(order.subtotalRupees)}</dd></div>
        {order.discountRupees ? <div className="wg-saving"><dt>{t("wg_couponLine", { code: order.couponCode ?? "" })}</dt><dd>− {rupees(order.discountRupees)}</dd></div> : null}
        <div><dt>{t("wg_deliveryFee")}</dt><dd>{order.deliveryRupees ? rupees(order.deliveryRupees) : t("wg_free")}</dd></div>
        <div className="wg-grand"><dt>{t("wg_toPay")}</dt><dd>{rupees(order.totalRupees)}</dd></div>
      </dl>
      <p className="wg-paynote">{t(paidOnline ? "pay_receiptPaid" : order.status === "delivered" ? "wg_paidOnDelivery" : "wg_payOnDelivery")}{order.shop.gstin ? ` ${t("wg_gstIncluded")}` : ""}</p>
      <div className="wg-deliver-to">
        <MapPin size={16} />
        <div>
          <strong>{order.area}</strong>
          <span>{order.address}</span>
          {order.note ? <em>“{order.note}”</em> : null}
        </div>
      </div>
    </section>
  );
}

function AfterDelivery({ order, token }: { order: TrackedOrder; token: string }) {
  const t = useT();
  const navigate = useNavigate();
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [rated, setRated] = useState<number | null>(order.review?.stars ?? null);
  const user = useAuthStore((s) => s.user);
  const [photo, setPhoto] = useState<File | null>(null);
  const [rateError, setRateError] = useState("");
  const [reporting, setReporting] = useState(false);
  const [issue, setIssue] = useState("");
  const [details, setDetails] = useState("");
  const [reported, setReported] = useState(false);
  const [busy, setBusy] = useState(false);

  async function rate() {
    setBusy(true);
    try {
      setRateError("");
      const path = user && photo ? await BusinessService.uploadReviewPhoto(user.id, await shrinkImage(photo, 1400)) : null;
      const answer = await BusinessService.rateOrder(token, stars, comment, path);
      if (answer === "ok" || answer === "already") setRated(stars);
      else setRateError(t("biz_errGeneric"));
    } catch (err) {
      setRateError(err instanceof Error ? err.message : t("biz_errGeneric"));
    } finally {
      setBusy(false);
    }
  }

  async function report() {
    setBusy(true);
    try {
      const answer = await BusinessService.reportProblem(token, issue, details);
      if (answer === "ok" || answer === "too_many") setReported(true);
    } finally {
      setBusy(false);
    }
  }

  function again() {
    setReorder(order.shop.id, order.items.map((l) => ({ itemId: l.id, qty: l.qty, selection: l.selection ?? [] })));
    navigate(`/shop/${order.shop.id}`);
  }

  return (
    <section className="wg-card wg-after">
      {rated ? (
        <>
          <p className="wg-rated"><Star size={16} fill="currentColor" /> {t("wg_rated", { stars: String(rated), shop: order.shop.name })}</p>
          {order.review?.photoUrl ? <img className="wg-review-photo" src={order.review.photoUrl} alt="" /> : null}
          {order.review?.reply ? <blockquote className="wg-reply"><strong>{t("wg_shopReplied", { shop: order.shop.name })}</strong>{order.review.reply}</blockquote> : null}
        </>
      ) : (
        <>
          <h2 className="wg-h2">{t("wg_rateTitle", { shop: order.shop.name })}</h2>
          <div className="wg-stars" role="radiogroup" aria-label={t("wg_rateTitle", { shop: order.shop.name })}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={t("wg_starsN", { n: String(n) })}
                className={n <= stars ? "is-on" : ""} onClick={() => setStars(n)}>
                <Star size={30} fill={n <= stars ? "currentColor" : "none"} />
              </button>
            ))}
          </div>
          {stars ? (
            <>
              <textarea className="wg-input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t("wg_ratePh")} maxLength={300} rows={2} />
              {user ? (
                <label className={`wg-photo-pick${photo ? " has-photo" : ""}`}>
                  <input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
                  {photo ? <img src={URL.createObjectURL(photo)} alt="" /> : <Camera size={18} />}
                  <span>{t(photo ? "wg_photoChange" : "wg_photoAdd")}</span>
                </label>
              ) : <p className="wg-fine">{t("wg_photoSignIn")}</p>}
              <p className="wg-fine">{t("wg_reviewPublic")}</p>
              {rateError ? <p className="wg-error">{rateError}</p> : null}
              <Button disabled={busy} onClick={() => void rate()}>{t("wg_rateSend")}</Button>
            </>
          ) : null}
        </>
      )}
      <div className="wg-after-actions">
        <button type="button" className="wg-btn wg-btn-primary" onClick={again}><RotateCcw size={16} /> {t("wg_orderAgain")}</button>
        {!reporting && !reported && order.issues < 3 ? (
          <button type="button" className="wg-btn wg-btn-soft" onClick={() => setReporting(true)}><AlertTriangle size={16} /> {t("wg_report")}</button>
        ) : null}
      </div>
      {reported ? <p className="wg-ok">{t("wg_reported", { shop: order.shop.name })}</p> : null}
      {reporting && !reported ? (
        <div className="wg-report">
          <div className="wg-chips" role="radiogroup" aria-label={t("wg_report")}>
            {ISSUES.map((i) => (
              <button key={i.id} type="button" role="radio" aria-checked={issue === i.id} className={issue === i.id ? "is-on" : ""} onClick={() => setIssue(i.id)}>{t(i.label)}</button>
            ))}
          </div>
          <textarea className="wg-input" value={details} onChange={(e) => setDetails(e.target.value)} placeholder={t("wg_reportPh")} maxLength={500} rows={3} />
          <Button disabled={busy || !issue} onClick={() => void report()}>{t("wg_reportSend")}</Button>
        </div>
      ) : null}
    </section>
  );
}

function CancelButton({ token, onDone }: { token: string; onDone: (o: TrackedOrder | null) => void }) {
  const t = useT();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!asking) return <button type="button" className="wg-btn wg-btn-ghost" onClick={() => setAsking(true)}>{t("wg_cancel")}</button>;
  return (
    <span className="wg-confirm">
      {t("wg_cancelSure")}
      <button type="button" className="wg-btn wg-btn-danger" disabled={busy}
        onClick={() => { setBusy(true); void BusinessService.cancelMyOrder(token).then(() => BusinessService.trackOrder(token)).then(onDone).finally(() => setBusy(false)); }}>
        {t("wg_cancelYes")}
      </button>
      <button type="button" className="wg-btn wg-btn-ghost" onClick={() => setAsking(false)}>{t("wg_cancelNo")}</button>
    </span>
  );
}
