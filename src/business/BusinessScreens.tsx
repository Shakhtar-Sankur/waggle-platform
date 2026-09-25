import { CheckCircle2, Clock3, Copy, IdCard, IndianRupee, LocateFixed, LogOut, PackagePlus, ShieldCheck, ShieldAlert, Star, Store } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { RatingService } from "../services/RatingService";
import { Button } from "../components/ui/Button";
import { BeeMark } from "../components/Wordmark";
import { APP_NAME } from "../config/constants";
import { useT, type TKey } from "../i18n";
import { LocationService } from "../services/LocationService";
import { CategoryPicker, KycChecklist } from "./BusinessKyc";
import {
  estimate,
  MAX_DELIVERY_KM,
  PLANS,
  type Business,
  type BusinessJob,
  type BusinessKind,
  type NewBusiness,
  type NewDelivery,
  type RiderPayee,
} from "./BusinessService";
import { LiveDeliveriesMap } from "./LiveMap";
import { MapPicker, type LatLng } from "./MapPicker";

export const rupees = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const JOB_STATUS: Record<BusinessJob["status"], TKey> = {
  open: "biz_jobOpen",
  accepted: "biz_jobAccepted",
  picked_up: "biz_jobPickedUp",
  completed: "biz_jobCompleted",
  cancelled: "biz_jobCancelled",
  declined: "biz_jobDeclined",
};

/** The band at the top of every Waggle Business screen. */
export function BusinessTop({ business, onSignOut, children }: { business?: Business | null; onSignOut?: () => void; children?: ReactNode }) {
  const t = useT();
  return (
    <header className="biz-top">
      <div className="biz-top-row">
        {/* Same bee and name as the family; the badge says which app this is. */}
        <div className="biz-brand" aria-label={APP_NAME}>
          <BeeMark size={30} />
          <span>Waggle</span>
          <span className="biz-badge">Business</span>
        </div>
        {onSignOut ? (
          <button type="button" className="biz-icon-button" onClick={onSignOut} aria-label={t("biz_signOut")}>
            <LogOut size={18} />
          </button>
        ) : null}
      </div>
      {business ? (
        <div className="biz-top-business">
          <h1>{business.name}</h1>
          <span className={`biz-status biz-status-${business.status}`}>
            {business.status === "verified" ? <ShieldCheck size={14} /> : business.status === "pending" ? <Clock3 size={14} /> : <ShieldAlert size={14} />}
            {t(business.status === "verified" ? "biz_statusVerified" : business.status === "pending" ? "biz_statusPending"
              : business.status === "rejected" ? "biz_rejectedTitle" : "biz_statusSuspended")}
          </span>
        </div>
      ) : null}
      {children}
    </header>
  );
}

/* ------------------------------------------------------------------ register */

export function RegisterBusinessScreen({
  onSubmit,
  onSignOut,
  initial,
  title,
  subtitle,
  submitLabel,
  nav,
}: {
  onSubmit: (b: NewBusiness) => Promise<void>;
  onSignOut?: () => void;
  /** Editing an existing business rather than registering a new one. */
  initial?: Business;
  title?: string;
  subtitle?: string;
  submitLabel?: string;
  nav?: ReactNode;
}) {
  const t = useT();
  const [name, setName] = useState(initial?.name ?? "");
  const [kind, setKind] = useState<BusinessKind>(initial?.kind ?? "restaurant");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [pin, setPin] = useState<LatLng | null>(initial ? { lat: initial.lat, lng: initial.lng } : null);
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function locate() {
    setLocating(true);
    try {
      const point = await LocationService.currentPosition();
      setPin({ lat: point.lat, lng: point.lng });
    } finally {
      setLocating(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (name.trim().length < 2 || address.trim().length < 5 || !pin) {
      setError(t("biz_errFields"));
      return;
    }
    setBusy(true);
    try {
      await onSubmit({ name, kind, phone, address, lat: pin.lat, lng: pin.lng });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("biz_errGeneric"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="biz-frame">
      <BusinessTop onSignOut={onSignOut}>
        <div className="biz-top-business">
          <h1>{title ?? t("biz_registerTitle")}</h1>
          <p>{subtitle ?? t("biz_registerSub")}</p>
        </div>
      </BusinessTop>
      {nav}
      <form className="biz-body" onSubmit={submit}>
        <section className="biz-card">
          <label className="biz-field">
            <span>{t("biz_name")}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("biz_namePh")} maxLength={80} />
          </label>
          <div className="biz-field">
            <span>{t("biz_kind")}</span>
            <CategoryPicker value={kind} onChange={setKind} />
          </div>
          <label className="biz-field">
            <span>{t("biz_phone")}</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t("biz_phonePh")} inputMode="tel" maxLength={20} />
          </label>
          <label className="biz-field">
            <span>{t("biz_address")}</span>
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t("biz_addressPh")} maxLength={200} />
          </label>
        </section>

        <section className="biz-card">
          <div className="biz-card-head">
            <strong>{t("biz_pin")}</strong>
            <button type="button" className="biz-link" onClick={() => void locate()} disabled={locating}>
              <LocateFixed size={15} /> {locating ? t("biz_locating") : t("biz_useLocation")}
            </button>
          </div>
          <MapPicker value={pin} onChange={setPin} />
          <p className="biz-help">{t("biz_pinHelp")}</p>
        </section>

        {!initial ? <p className="biz-help">{t("bx_registerNext")}</p> : null}
        {error ? <p className="biz-error" role="alert">{error}</p> : null}
        <Button type="submit" disabled={busy} className="biz-primary">{submitLabel ?? t("biz_submit")}</Button>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ pending / paused */

export function PendingScreen({
  business,
  missing = [],
  onRefresh,
  onSignOut,
  onFix,
  onVerify,
}: {
  business: Business;
  /** What Gigzen still needs, from my_business_missing(). */
  missing?: string[];
  onRefresh: () => void;
  onSignOut?: () => void;
  /** Edit the business details (name, category, address, pin). */
  onFix?: () => void;
  /** The owner's details and papers. */
  onVerify?: () => void;
}) {
  const t = useT();
  const paused = business.status === "suspended";
  const rejected = business.status === "rejected";
  return (
    <div className="biz-frame">
      <BusinessTop business={business} onSignOut={onSignOut} />
      <div className="biz-body">
        {missing.length && !paused ? (
          <section className="biz-card biz-state">
            <div className="biz-state-icon"><IdCard size={26} /></div>
            <h2>{t("bx_finishTitle")}</h2>
            <p>{t("bx_finishBody", { name: business.name })}</p>
            {business.reviewNote && rejected ? <blockquote className="biz-note">{business.reviewNote}</blockquote> : null}
            <KycChecklist business={business} missing={missing} />
            {onVerify ? <Button onClick={onVerify}>{t("bx_finishButton")}</Button> : null}
          </section>
        ) : (
          <section className={`biz-card biz-state${rejected || paused ? " is-problem" : ""}`}>
            <div className="biz-state-icon">{paused || rejected ? <ShieldAlert size={26} /> : <Clock3 size={26} />}</div>
            <h2>{t(paused ? "biz_suspendedTitle" : rejected ? "biz_rejectedTitle" : "biz_pendingTitle")}</h2>
            <p>{t(paused ? "biz_suspendedBody" : rejected ? "biz_rejectedBody" : "biz_pendingBody", { name: business.name })}</p>
            {business.reviewNote && (rejected || paused) ? <blockquote className="biz-note">{business.reviewNote}</blockquote> : null}
            {rejected ? (
              <div className="biz-decide">
                {onFix ? <Button onClick={onFix}>{t("biz_fixDetails")}</Button> : null}
                {onVerify ? <Button variant="outline" onClick={onVerify}>{t("bx_fixPapers")}</Button> : null}
              </div>
            ) : (
              <Button variant="outline" onClick={onRefresh}>{t("biz_checkAgain")}</Button>
            )}
          </section>
        )}
        <section className="biz-card biz-facts">
          <div><span>{t("biz_kind")}</span><strong>{t(`bx_kind_${business.kind}` as TKey)}</strong></div>
          <div><span>{t("biz_address")}</span><strong>{business.address}</strong></div>
          {business.phone ? <div><span>{t("biz_phone")}</span><strong>{business.phone}</strong></div> : null}
          {business.gstin ? <div><span>GSTIN</span><strong>{business.gstin}</strong></div> : null}
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ home */

export function BusinessHomeScreen({
  business,
  jobs,
  onSend,
  onCancel,
  onSignOut,
  sendPanel,
  nav,
  onPayee,
  onMarkPaid,
}: {
  business: Business;
  jobs: BusinessJob[];
  onSend: () => void;
  onCancel: (jobId: string) => void;
  /** Paying riders: who to pay, and recording the UPI payment. */
  onPayee?: (jobId: string) => Promise<RiderPayee | null>;
  onMarkPaid?: (jobId: string, utr: string) => Promise<void>;
  onSignOut?: () => void;
  /** The send form, shown beside the list on a computer. Phones use the button. */
  sendPanel?: ReactNode;
  nav?: ReactNode;
}) {
  const t = useT();
  const today = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const mine = jobs.filter((j) => new Date(j.createdAt) >= start && j.status !== "cancelled");
    const taken = mine.filter((j) => j.status === "accepted" || j.status === "picked_up" || j.status === "completed");
    // Waggle's fee is charged when an order is delivered, so only those count here.
    const delivered = mine.filter((j) => j.status === "completed");
    return { sent: mine.length, taken: taken.length, fees: delivered.reduce((sum, j) => sum + j.feeRupees, 0) };
  }, [jobs]);
  // Riders are paid by the shop, straight to their UPI; these are still owed.
  const owed = jobs.filter((j) => j.status === "completed" && j.assignedTo && (!j.riderPaidAt || j.riderPayDisputedAt));
  const owedRupees = owed.reduce((sum, j) => sum + j.fare, 0);

  return (
    <div className={`biz-frame${sendPanel ? " biz-frame-wide" : ""}`}>
      <BusinessTop business={business} onSignOut={onSignOut}>
        <button type="button" className={`biz-send${sendPanel ? " biz-phone-only" : ""}`} onClick={onSend}>
          <span className="biz-send-icon"><PackagePlus size={22} /></span>
          <span>
            <strong>{t("biz_send")}</strong>
            <small>{t("biz_sendSub")}</small>
          </span>
        </button>
      </BusinessTop>
      {nav}
      <div className={sendPanel ? "biz-columns" : undefined}>
      {sendPanel ? (
        <aside className="biz-side">
          <div className="biz-side-head">
            <strong>{t("biz_sendTitle")}</strong>
            <p>{t("biz_sendSubtitle")}</p>
          </div>
          {sendPanel}
        </aside>
      ) : null}
      <div className="biz-body">
        <section className="biz-card">
          <div className="biz-card-head"><strong>{t("biz_today")}</strong></div>
          <div className="biz-stats">
            <div><b>{today.sent}</b><span>{t("biz_statSent")}</span></div>
            <div><b>{today.taken}</b><span>{t("biz_statTaken")}</span></div>
            <div><b>{rupees(today.fees)}</b><span>{t("biz_statFees")}</span></div>
          </div>
        </section>

        {owed.length && onPayee ? (
          <section className="biz-card biz-owed" role="status">
            <IndianRupee size={20} />
            <div>
              <strong>{t(owed.length === 1 ? "bx_owedOne" : "bx_owedMany", { count: String(owed.length), total: rupees(owedRupees) })}</strong>
              <p>{t("bx_owedHelp")}</p>
            </div>
          </section>
        ) : null}

        {/* Live only for the real app: the preview has no riders to follow. */}
        {onPayee && business.id !== "preview" ? (
          <LiveDeliveriesMap business={business} activeCount={jobs.filter((j) => j.status === "accepted" || j.status === "picked_up").length} />
        ) : null}

        <section className="biz-card">
          <div className="biz-card-head"><strong>{t("biz_jobsTitle")}</strong></div>
          {jobs.length === 0 ? (
            <div className="biz-empty"><Store size={22} /><p>{t("biz_jobsEmpty")}</p></div>
          ) : (
            <ul className="biz-jobs">
              {jobs.map((job) => (
                <li key={job.id} className={`biz-job biz-job-${job.status}`}>
                  <div className="biz-job-main">
                    <strong>
                      {job.dropoffArea}
                      {job.source !== "app" ? <span className="biz-source">{job.source === "order" ? t("bx_srcOrder", { code: job.reference ?? "" }) : t("bx_srcApi", { ref: job.reference ?? "" })}</span> : null}
                    </strong>
                    <span className="biz-job-line">
                      {t("biz_jobLine", { km: String(job.distanceKm), fare: rupees(job.fare), fee: rupees(job.feeRupees) })}
                    </span>
                    <span className="biz-job-status">{t(JOB_STATUS[job.status])} · {new Date(job.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                    {job.dropoffAddress && (job.status === "open" || job.status === "accepted" || job.status === "picked_up") ? (
                      <span className="biz-job-line">{job.dropoffAddress}</span>
                    ) : null}
                    {job.pickupCode && (job.status === "open" || job.status === "accepted") ? (
                      <span className="biz-code"><span>{t("biz_pickupCode")}</span><b>{job.pickupCode}</b></span>
                    ) : null}
                    {job.deliveryCode && (job.status === "open" || job.status === "accepted" || job.status === "picked_up") ? (
                      <span className="biz-code"><span>{t("biz_deliveryCode")}</span><b>{job.deliveryCode}</b></span>
                    ) : null}
                    {job.status === "completed" && job.assignedTo && onPayee && onMarkPaid ? (
                      <RiderPay job={job} onPayee={onPayee} onMarkPaid={onMarkPaid} />
                    ) : null}
                    {job.status === "completed" && job.assignedTo && onPayee && Date.now() - new Date(job.createdAt).getTime() < 7 * 86400000 ? (
                      <ShopRateRider jobId={job.id} />
                    ) : null}
                  </div>
                  {job.status === "open" ? (
                    <Button variant="ghost" size="sm" onClick={() => onCancel(job.id)}>{t("biz_jobCancel")}</Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      </div>
    </div>
  );
}

/** On a delivered job: how was the rider? The rider sees only their average; a reason goes to Gigzen. */
function ShopRateRider({ jobId }: { jobId: string }) {
  const t = useT();
  const [rated, setRated] = useState<number | null | undefined>(undefined);
  const [stars, setStars] = useState(0);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void RatingService.shopRating(jobId).then((r) => live && setRated(r)).catch(() => live && setRated(null));
    return () => { live = false; };
  }, [jobId]);
  if (rated === undefined) return null;
  if (rated) return <span className="biz-rated"><Star size={14} fill="currentColor" /> {t("bx_rrDone", { stars: String(rated) })}</span>;

  async function send() {
    setBusy(true);
    setError("");
    try {
      const answer = await RatingService.rateFromShop(jobId, stars, reason);
      if (answer === "ok" || answer === "already") setRated(stars);
      else setError(t("biz_errGeneric"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("biz_errGeneric"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="biz-rate">
      <span>{t("bx_rrTitle")}</span>
      <div className="biz-stars" role="radiogroup" aria-label={t("bx_rrTitle")}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={t("wg_starsN", { n: String(n) })}
            className={n <= stars ? "is-on" : ""} onClick={() => setStars(n)}>
            <Star size={22} fill={n <= stars ? "currentColor" : "none"} />
          </button>
        ))}
      </div>
      {stars ? (
        <>
          {stars <= 3 ? (
            <input className="biz-rate-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder={t("bx_rrPh")} />
          ) : null}
          {error ? <p className="biz-error">{error}</p> : null}
          <Button size="sm" disabled={busy} onClick={() => void send()}>{t("bx_rrSend")}</Button>
        </>
      ) : null}
    </div>
  );
}

/** On a delivered job: pay the rider's fare by UPI, then record the UTR. */
function RiderPay({ job, onPayee, onMarkPaid }: {
  job: BusinessJob;
  onPayee: (jobId: string) => Promise<RiderPayee | null>;
  onMarkPaid: (jobId: string, utr: string) => Promise<void>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [payee, setPayee] = useState<RiderPayee | null>(null);
  const [utr, setUtr] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const disputed = Boolean(job.riderPayDisputedAt);

  if (job.riderPaidAt && !disputed) {
    return (
      <span className="biz-paid"><CheckCircle2 size={15} /> {t("bx_riderPaid", { fare: rupees(job.fare), utr: job.riderPayUtr ?? "" })}</span>
    );
  }

  async function start() {
    setOpen(true);
    setError("");
    try {
      const p = await onPayee(job.id);
      if (!p?.upi) setError(t("bx_rpNoUpi"));
      setPayee(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("biz_errGeneric"));
    }
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      await onMarkPaid(job.id, utr);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("biz_errGeneric"));
    } finally {
      setBusy(false);
    }
  }

  // Opens GPay, PhonePe, Paytm or BHIM with the rider, the amount and a note filled in.
  const upiLink = payee?.upi
    ? `upi://pay?pa=${encodeURIComponent(payee.upi)}&pn=${encodeURIComponent(payee.name)}&am=${payee.fare.toFixed(2)}&cu=INR&tn=${encodeURIComponent(`Waggle delivery to ${job.dropoffArea}`.slice(0, 50))}`
    : "";

  return (
    <div className={`biz-riderpay${disputed ? " is-disputed" : ""}`}>
      {disputed ? <p className="biz-error">{t("bx_riderDisputed", { utr: job.riderPayUtr ?? "" })}</p> : null}
      {!open ? (
        <Button size="sm" onClick={() => void start()}>{t("bx_payRider", { fare: rupees(job.fare) })}</Button>
      ) : (
        <>
          {payee ? (
            <div className="biz-payee">
              <span>{t("bx_rpTo")}</span>
              <strong>{payee.name}</strong>
              {payee.upi ? (
                <button type="button" className="biz-upi-id" onClick={() => { void navigator.clipboard?.writeText(payee.upi ?? ""); setCopied(true); }}>
                  <code>{payee.upi}</code> <Copy size={14} /> <small>{copied ? t("bx_copied") : t("bx_copy")}</small>
                </button>
              ) : null}
            </div>
          ) : !error ? <p className="biz-help">{t("biz_loading")}</p> : null}
          {upiLink ? <a className="biz-upi-open" href={upiLink}>{t("bx_payOpenUpi", { fare: rupees(payee?.fare ?? job.fare) })}</a> : null}
          {payee?.upi ? (
            <>
              <label className="biz-field">
                <span>{t("bx_rpUtr")}</span>
                <input value={utr} onChange={(e) => setUtr(e.target.value.toUpperCase())} inputMode="numeric" placeholder="4234 5678 9012" maxLength={26} autoComplete="off" />
              </label>
              <Button size="sm" disabled={busy || utr.replace(/\s/g, "").length < 10} onClick={() => void save()}>{t("bx_payDone")}</Button>
              <p className="biz-help">{t("bx_payHelp")}</p>
            </>
          ) : null}
          {error ? <p className="biz-error" role="alert">{error}</p> : null}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ send a delivery */

export function SendDeliveryScreen({
  business,
  onSend,
  onBack,
}: {
  business: Business;
  onSend: (delivery: NewDelivery) => Promise<void>;
  onBack: () => void;
}) {
  const t = useT();
  return (
    <div className="biz-frame">
      <BusinessTop business={business}>
        <div className="biz-top-business">
          <button type="button" className="biz-back" onClick={onBack}>← {t("biz_back")}</button>
          <h1>{t("biz_sendTitle")}</h1>
          <p>{t("biz_sendSubtitle")}</p>
        </div>
      </BusinessTop>
      <SendDeliveryForm business={business} onSend={onSend} />
    </div>
  );
}

/** The form itself: a screen of its own on a phone, the side panel on a computer. */
export function SendDeliveryForm({
  business,
  onSend,
}: {
  business: Business;
  onSend: (delivery: NewDelivery) => Promise<void>;
}) {
  const t = useT();
  const [pin, setPin] = useState<LatLng | null>(null);
  const [area, setArea] = useState("");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const quote = pin ? estimate(business.lat, business.lng, pin.lat, pin.lng) : null;
  const tooFar = quote ? quote.straightKm > MAX_DELIVERY_KM : false;
  const ready = Boolean(pin && !tooFar && area.trim().length >= 2 && address.trim().length >= 5);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || !pin || busy) return;
    setBusy(true);
    setError("");
    try {
      await onSend({ dropoffArea: area, dropoffAddress: address, dropoffLat: pin.lat, dropoffLng: pin.lng, note });
      // Ready for the next one: on a computer the form stays on screen.
      setPin(null);
      setArea("");
      setAddress("");
      setNote("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("biz_errGeneric"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="biz-body" onSubmit={submit}>
      <section className="biz-card">
        <div className="biz-card-head"><strong>{t("biz_dropPin")}</strong></div>
        <MapPicker value={pin} onChange={setPin} anchor={{ lat: business.lat, lng: business.lng }} height={260} />
        <p className="biz-help">{t("biz_dropHelp")}</p>
      </section>

      <section className="biz-card">
        <label className="biz-field">
          <span>{t("biz_area")}</span>
          <input value={area} onChange={(e) => setArea(e.target.value)} placeholder={t("biz_areaPh")} maxLength={60} />
        </label>
        <label className="biz-field">
          <span>{t("biz_fullAddress")}</span>
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t("biz_fullAddressPh")} maxLength={200} />
        </label>
        <label className="biz-field">
          <span>{t("biz_note")}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("biz_notePh")} maxLength={200} />
        </label>
      </section>

      <section className="biz-card biz-quote" aria-live="polite">
        {!quote ? (
          <p className="biz-help">{t("biz_estPin")}</p>
        ) : tooFar ? (
          <p className="biz-error">{t("biz_estFar", { km: String(MAX_DELIVERY_KM) })}</p>
        ) : (
          <>
            <div><span>{t("biz_estDistance")}</span><strong>{quote.km} km</strong></div>
            <div><span>{t("biz_estFare")}</span><strong>{rupees(quote.fare)}</strong></div>
            <div><span>{t("biz_estFee")}</span><strong>{rupees(PLANS[business.plan].routing)}</strong></div>
          </>
        )}
      </section>

      {error ? <p className="biz-error" role="alert">{error}</p> : null}
      <Button type="submit" disabled={!ready || busy} className="biz-primary">{t("biz_sendButton")}</Button>
    </form>
  );
}
