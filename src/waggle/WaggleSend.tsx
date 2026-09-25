import { BadgeCheck, CalendarClock, Camera, ChevronLeft, Copy, LocateFixed, Package, PackageCheck, Search, Share2, ShieldAlert, Truck, X, Zap } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { MapPicker, type LatLng } from "../business/MapPicker";
import { useT, type TKey } from "../i18n";
import { LocationService } from "../services/LocationService";
import { useAuthStore } from "../stores/useAuthStore";
import { rupees, WgFrame } from "./common";
import { SendService, type ParcelKind, type ParcelSize, type SendQuote, type TrackedSend } from "./SendService";
import { TrackMap } from "./TrackMap";
import { RateRider, RiderAverage, useDeliveryRating } from "./RateRider";
import { useWaggleLocation } from "./useWaggleLocation";

const KINDS: ParcelKind[] = ["documents", "food", "clothes", "electronics", "keys", "medicine", "other"];
const SIZES: ParcelSize[] = ["envelope", "small", "medium"];
const PHONE_RE = /^(\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}$/;
const localValue = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "");

/** Book a Send: where from, where to, who, what, when, and the price before anything is booked. */
export function SendPage() {
  const t = useT();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const home = useWaggleLocation((s) => s.place);
  const [pickPin, setPickPin] = useState<LatLng | null>(home ? { lat: home.lat, lng: home.lng } : null);
  const [pickArea, setPickArea] = useState(home?.area ?? "");
  const [pickAddress, setPickAddress] = useState(home?.address ?? "");
  const [pickName, setPickName] = useState(user?.fullName ?? "");
  const [pickPhone, setPickPhone] = useState(user?.phone?.replace(/^\+91/, "") ?? "");
  const [dropPin, setDropPin] = useState<LatLng | null>(null);
  const [dropArea, setDropArea] = useState("");
  const [dropAddress, setDropAddress] = useState("");
  const [dropName, setDropName] = useState("");
  const [dropPhone, setDropPhone] = useState("");
  const [kind, setKind] = useState<ParcelKind>("documents");
  const [size, setSize] = useState<ParcelSize>("envelope");
  const [fragile, setFragile] = useState(false);
  const [description, setDescription] = useState("");
  const [riderNote, setRiderNote] = useState("");
  const [when, setWhen] = useState<"now" | "later">("now");
  const [later, setLater] = useState(localValue(new Date(Date.now() + 60 * 60000)));
  const [banned, setBanned] = useState(false);
  const [feeUtr, setFeeUtr] = useState("");
  const [quote, setQuote] = useState<SendQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!pickPin || !dropPin || !user) { setQuote(null); return; }
    let live = true;
    SendService.quote(pickPin, dropPin).then((q) => live && setQuote(q)).catch(() => live && setQuote(null));
    return () => { live = false; };
  }, [pickPin?.lat, pickPin?.lng, dropPin?.lat, dropPin?.lng, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!user) {
    return (
      <WgFrame nav bar={<Link to="/" className="wg-back"><ChevronLeft size={18} /> {t("wg_backHome")}</Link>}>
        <main className="wg-page">
          <section className="wg-card wg-empty">
            <Truck size={28} />
            <h2>{t("sd_signInTitle")}</h2>
            <p>{t("sd_signInSub")}</p>
            <Link className="wg-btn wg-btn-primary" to="/auth">{t("sd_signIn")}</Link>
          </section>
        </main>
      </WgFrame>
    );
  }

  async function locate() {
    setLocating(true);
    try {
      const p = await LocationService.currentPosition();
      if (!p.fallback) setPickPin({ lat: p.lat, lng: p.lng });
    } finally {
      setLocating(false);
    }
  }

  const laterOk = when === "now" || (new Date(later).getTime() > Date.now() + 29 * 60000 && new Date(later).getTime() < Date.now() + 7 * 86400000);
  const place = (area: string, address: string, name: string, phone: string, pin: LatLng | null) =>
    area.trim().length >= 2 && address.trim().length >= 5 && name.trim().length >= 2 && PHONE_RE.test(phone.trim()) && !!pin;
  const utrOk = !quote?.feeLive || /^[0-9A-Z]{10,22}$/.test(feeUtr.replace(/\s/g, "").toUpperCase());
  const ready = place(pickArea, pickAddress, pickName, pickPhone, pickPin) && place(dropArea, dropAddress, dropName, dropPhone, dropPin)
    && banned && laterOk && !!quote && !quote.tooFar && !quote.tooClose && utrOk;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || !pickPin || !dropPin) return;
    setBusy(true);
    setError("");
    try {
      const r = await SendService.book({
        pickup: { name: pickName, phone: pickPhone, area: pickArea, address: pickAddress, lat: pickPin.lat, lng: pickPin.lng },
        drop: { name: dropName, phone: dropPhone, area: dropArea, address: dropAddress, lat: dropPin.lat, lng: dropPin.lng },
        kind, size, fragile, description, riderNote, bannedAck: banned,
        scheduledFor: when === "later" ? new Date(later).toISOString() : null,
        feeUtr: quote?.feeLive ? feeUtr.replace(/\s/g, "").toUpperCase() : null,
      });
      navigate(`/send/${r.token}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("biz_errGeneric"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <WgFrame bar={<Link to="/" className="wg-back"><ChevronLeft size={18} /> {t("wg_backHome")}</Link>}>
      <form className="wg-page sd-page" onSubmit={submit}>
        <header className="sd-head">
          <span className="sd-head-icon"><Package size={24} /></span>
          <div>
            <h1>{t("sd_title")}</h1>
            <p>{t("sd_sub")}</p>
          </div>
        </header>

        <Stop title={t("sd_from")} tone="from">
          <div className="wg-h2-row">
            <span className="wg-fine">{t("sd_pinFrom")}</span>
            <button type="button" className="wg-link" onClick={() => void locate()} disabled={locating}><LocateFixed size={15} /> {t("wg_useLocation")}</button>
          </div>
          <MapPicker value={pickPin} onChange={setPickPin} anchor={home ? { lat: home.lat, lng: home.lng } : null} height={190} />
          <Field label={t("wg_area")} value={pickArea} onChange={setPickArea} max={60} />
          <Field label={t("sd_address")} value={pickAddress} onChange={setPickAddress} max={200} ph={t("wg_addressPh")} />
          <div className="wg-row">
            <Field label={t("sd_senderName")} value={pickName} onChange={setPickName} max={60} />
            <Field label={t("wg_phone")} value={pickPhone} onChange={setPickPhone} max={16} tel ph="98765 43210" />
          </div>
        </Stop>

        <Stop title={t("sd_to")} tone="to">
          <span className="wg-fine">{t("sd_pinTo")}</span>
          <MapPicker value={dropPin} onChange={setDropPin} anchor={pickPin} height={190} />
          <Field label={t("wg_area")} value={dropArea} onChange={setDropArea} max={60} />
          <Field label={t("sd_address")} value={dropAddress} onChange={setDropAddress} max={200} ph={t("wg_addressPh")} />
          <div className="wg-row">
            <Field label={t("sd_recipientName")} value={dropName} onChange={setDropName} max={60} />
            <Field label={t("wg_phone")} value={dropPhone} onChange={setDropPhone} max={16} tel ph="98765 43210" />
          </div>
        </Stop>

        <section className="wg-card">
          <h2 className="wg-h2">{t("sd_what")}</h2>
          <div className="wg-chips" role="radiogroup" aria-label={t("sd_what")}>
            {KINDS.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? "is-on" : ""} onClick={() => setKind(k)}>{t(`sd_kind_${k}` as TKey)}</button>
            ))}
          </div>
          <h2 className="wg-h2 sd-gap">{t("sd_size")}</h2>
          <div className="sd-sizes" role="radiogroup" aria-label={t("sd_size")}>
            {SIZES.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={size === s} className={size === s ? "is-on" : ""} onClick={() => setSize(s)}>
                <b>{t(`sd_size_${s}` as TKey)}</b><small>{t(`sd_size_${s}_sub` as TKey)}</small>
              </button>
            ))}
          </div>
          <label className="wg-keep"><input type="checkbox" checked={fragile} onChange={(e) => setFragile(e.target.checked)} /> {t("sd_fragile")}</label>
          <Field label={t("sd_description")} value={description} onChange={setDescription} max={200} ph={t("sd_descriptionPh")} />
          <Field label={t("sd_riderNote")} value={riderNote} onChange={setRiderNote} max={200} ph={t("sd_riderNotePh")} />
        </section>

        <section className="wg-card">
          <h2 className="wg-h2">{t("sd_when")}</h2>
          <div className="wg-when">
            <button type="button" className={when === "now" ? "is-on" : ""} onClick={() => setWhen("now")}>
              <Zap size={16} /> <span><strong>{t("sd_now")}</strong><small>{t("sd_nowSub")}</small></span>
            </button>
            <button type="button" className={when === "later" ? "is-on" : ""} onClick={() => setWhen("later")}>
              <CalendarClock size={16} /> <span><strong>{t("wg_schedule")}</strong><small>{t("sd_laterSub")}</small></span>
            </button>
          </div>
          {when === "later" ? (
            <>
              <input className="wg-input" type="datetime-local" value={later} onChange={(e) => setLater(e.target.value)}
                min={localValue(new Date(Date.now() + 30 * 60000))} max={localValue(new Date(Date.now() + 7 * 86400000))} />
              {!laterOk ? <p className="wg-error">{t("sd_laterErr")}</p> : null}
            </>
          ) : null}
        </section>

        <section className="wg-card sd-banned">
          <h2 className="wg-h2"><ShieldAlert size={18} /> {t("sd_bannedTitle")}</h2>
          <p>{t("sd_bannedList")}</p>
          <label className="wg-keep"><input type="checkbox" checked={banned} onChange={(e) => setBanned(e.target.checked)} /> {t("sd_bannedAck")}</label>
        </section>

        <section className="wg-card wg-bill">
          <h2 className="wg-h2">{t("sd_price")}</h2>
          {!quote ? (
            <p className="wg-fine">{t("sd_pricePins")}</p>
          ) : quote.tooFar ? (
            <p className="wg-error">{t("sd_tooFar")}</p>
          ) : quote.tooClose ? (
            <p className="wg-error">{t("sd_tooClose")}</p>
          ) : (
            <>
              <dl>
                <div><dt>{t("sd_riderFare", { km: String(quote.km) })}</dt><dd>{rupees(quote.fare)}</dd></div>
                <div className={quote.feeLive ? "" : "wg-saving"}>
                  <dt>{t(quote.feeLive ? "sd_fee" : "sd_feeLaunch")}</dt>
                  <dd>{quote.feeLive ? rupees(quote.feeRupees) : <><s>{rupees(quote.feeRupees)}</s> {rupees(0)}</>}</dd>
                </div>
                <div className="wg-grand"><dt>{t("wg_toPay")}</dt><dd>{rupees(quote.total)}</dd></div>
              </dl>
              <p className="wg-paynote">{t("sd_payRider", { fare: rupees(quote.fare) })}</p>
              {quote.feeLive && quote.feeUpi ? (
                <div className="sd-feepay">
                  <a className="wg-btn wg-btn-light" href={`upi://pay?pa=${encodeURIComponent(quote.feeUpi)}&pn=Gigzen&am=${quote.feeRupees.toFixed(2)}&cu=INR&tn=${encodeURIComponent("Waggle Send fee")}`}>
                    {t("sd_payFee", { fee: rupees(quote.feeRupees), upi: quote.feeUpi })}
                  </a>
                  <Field label={t("sd_feeUtr")} value={feeUtr} onChange={setFeeUtr} max={26} ph="4234 5678 9012" />
                </div>
              ) : null}
            </>
          )}
        </section>

        {error ? <p className="wg-error" role="alert">{error}</p> : null}
        <div className="wg-placebar">
          <button type="submit" className="wg-btn wg-btn-primary wg-btn-block" disabled={!ready || busy}>
            {busy ? t("sd_booking") : quote && !quote.tooFar ? t(when === "later" ? "sd_bookLater" : "sd_book", { total: rupees(quote.total) }) : t("sd_bookPlain")}
          </button>
          {!ready ? <p className="wg-fine wg-center">{t("sd_bookHint")}</p> : null}
        </div>
      </form>
    </WgFrame>
  );
}

function Stop({ title, tone, children }: { title: string; tone: "from" | "to"; children: ReactNode }) {
  return (
    <section className={`wg-card sd-stop is-${tone}`}>
      <h2 className="wg-h2"><span className="sd-dot" aria-hidden /> {title}</h2>
      {children}
    </section>
  );
}

function Field({ label, value, onChange, max, ph, tel }: { label: string; value: string; onChange: (v: string) => void; max: number; ph?: string; tel?: boolean }) {
  return (
    <label className="wg-field"><span>{label}</span>
      <input className="wg-input" value={value} onChange={(e) => onChange(e.target.value)} maxLength={max} placeholder={ph}
        inputMode={tel ? "tel" : undefined} autoComplete={tel ? "tel" : undefined} />
    </label>
  );
}

/* ------------------------------------------------------------------ tracking */

/** Follow a Send: the sender (with both codes and the fare) or the recipient (delivery code only). */
export function SendTrackPage() {
  const t = useT();
  const { token = "" } = useParams();
  const [send, setSend] = useState<TrackedSend | null | undefined>(undefined);
  const [eta, setEta] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const told = useRef(false);
  const [riderRating, reloadRating] = useDeliveryRating(token, send?.status === "delivered");

  useEffect(() => {
    let live = true;
    const load = () => SendService.track(token).then((s) => live && setSend(s)).catch(() => live && setSend((p) => p ?? null));
    void load();
    const timer = window.setInterval(load, 8000);
    return () => { live = false; window.clearInterval(timer); };
  }, [token]);

  const near = send?.status === "picked_up" && eta != null && eta <= 3;
  useEffect(() => {
    if (near && !told.current) { told.current = true; try { navigator.vibrate?.([180, 80, 180]); } catch { /* none */ } }
  }, [near]);

  if (send === undefined) return <WgFrame><p className="wg-loading">{t("biz_loading")}</p></WgFrame>;
  if (send === null) {
    return (
      <WgFrame>
        <main className="wg-page"><section className="wg-card wg-empty"><Package size={28} /><h2>{t("sd_missing")}</h2><p>{t("sd_missingSub")}</p></section></main>
      </WgFrame>
    );
  }

  const sender = send.viewer === "sender";
  const rider = send.rider?.firstName ?? t("wg_yourRider");
  const shareUrl = send.shareToken ? `${window.location.origin}/send/${send.shareToken}` : "";
  const hero: Record<string, { icon: ReactNode; title: string; sub: string; tone: string }> = {
    booked: send.scheduledFor && new Date(send.scheduledFor).getTime() > Date.now() + 15 * 60000
      ? { icon: <CalendarClock size={26} />, title: t("sd_hScheduled"), sub: t("sd_sScheduled", { when: new Date(send.scheduledFor).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }) }), tone: "waiting" }
      : { icon: <Search size={26} />, title: t("sd_hFinding"), sub: t("sd_sFinding"), tone: "active" },
    assigned: { icon: <Truck size={26} />, title: t("sd_hComing", { rider }), sub: sender ? t("sd_sComingSender", { fare: rupees(send.fare ?? 0) }) : t("sd_sComing"), tone: "active" },
    picked_up: { icon: <Truck size={26} />, title: t("sd_hOnWay", { rider, name: send.drop.name }), sub: eta ? t("wg_sEta", { min: String(eta) }) : t("sd_sOnWay"), tone: "active" },
    delivered: { icon: <PackageCheck size={26} />, title: t("sd_hDelivered", { name: send.drop.name, time: clock(send.deliveredAt) }), sub: t("sd_sDelivered"), tone: "done" },
    cancelled: { icon: <X size={26} />, title: t("sd_hCancelled"), sub: t("sd_sCancelled"), tone: "stopped" },
  };
  const h = hero[send.status];
  const active = send.status !== "delivered" && send.status !== "cancelled";

  async function share() {
    const text = t("sd_shareText", { name: send!.pickup.name, url: shareUrl });
    try {
      if (navigator.share) await navigator.share({ title: "Waggle Send", text, url: shareUrl });
      else { await navigator.clipboard.writeText(text); setCopied(true); }
    } catch { /* closed */ }
  }

  return (
    <WgFrame bar={<span className="wg-ordercode">#{send.code}</span>}>
      <main className="wg-page">
        <section className={`wg-hero is-${h.tone}`} aria-live="polite">
          <span className="wg-hero-icon">{h.icon}</span>
          <div><h1>{h.title}</h1>{h.sub ? <p>{h.sub}</p> : null}</div>
          {send.status === "picked_up" && eta ? <div className="wg-eta"><b>{eta}</b><span>{t("wg_min")}</span></div> : null}
        </section>

        {near ? (
          <section className="wg-card wg-near" role="status"><Truck size={20} />
            <span><strong>{t("sd_nearTitle", { rider })}</strong><small>{t(sender ? "sd_nearSubSender" : "sd_nearSub")}</small></span>
          </section>
        ) : null}

        {sender && send.pickupCode && (send.status === "booked" || send.status === "assigned") ? (
          <section className="wg-card wg-code">
            <div><span>{t("sd_pickupCode")}</span><small>{t("sd_pickupCodeHelp")}</small></div>
            <b>{send.pickupCode}</b>
          </section>
        ) : null}
        {send.deliveryCode && active ? (
          <section className="wg-card wg-code">
            <div><span>{t(sender ? "sd_deliveryCodeSender" : "wg_codeTitle")}</span><small>{t(sender ? "sd_deliveryCodeSenderHelp" : "wg_codeHelp")}</small></div>
            <b>{send.deliveryCode}</b>
          </section>
        ) : null}

        {sender && send.status === "assigned" && send.rider?.upi && send.fare ? (
          <section className="wg-card sd-payrider">
            <h2 className="wg-h2">{t("sd_payRiderTitle", { fare: rupees(send.fare), rider })}</h2>
            <p className="wg-fine">{t("sd_payRiderHelp")}</p>
            <a className="wg-btn wg-btn-primary wg-btn-block" href={`upi://pay?pa=${encodeURIComponent(send.rider.upi)}&pn=${encodeURIComponent(rider)}&am=${send.fare.toFixed(2)}&cu=INR&tn=${encodeURIComponent(`Waggle Send ${send.code}`)}`}>
              {t("sd_payRiderUpi", { fare: rupees(send.fare) })}
            </a>
            <button type="button" className="wg-link" onClick={() => { void navigator.clipboard?.writeText(send.rider?.upi ?? ""); setCopied(true); }}>
              <Copy size={14} /> {send.rider.upi}{copied ? ` · ${t("bx_copied")}` : ""}
            </button>
          </section>
        ) : null}

        {active ? (
          <section className="wg-card wg-mapcard">
            <TrackMap
              shop={{ lat: send.pickup.lat, lng: send.pickup.lng }}
              drop={{ lat: send.drop.lat, lng: send.drop.lng }}
              rider={send.riderAt && (send.status === "picked_up" || send.status === "assigned") ? { lat: send.riderAt.lat, lng: send.riderAt.lng } : null}
              labels={{ shop: t("sd_mapFrom", { name: send.pickup.name }), drop: t("sd_mapTo", { name: send.drop.name }), rider }}
              onRoute={(r) => setEta(send.status === "picked_up" && r ? r.minutes + 1 : null)}
            />
          </section>
        ) : null}

        {send.rider ? (
          <section className="wg-card wg-rider">
            <span className="wg-avatar" aria-hidden>{send.rider.firstName.slice(0, 1).toUpperCase()}</span>
            <div>
              <strong>{send.rider.firstName} <RiderAverage rating={riderRating} /></strong>
              <span>{send.rider.vehicle ?? ""}{send.rider.plateLast4 ? ` · ••${send.rider.plateLast4}` : ""}</span>
              <small><BadgeCheck size={13} /> {t("wg_riderVerified")}</small>
            </div>
          </section>
        ) : null}

        {sender && send.status === "delivered" && send.rider ? <RateRider token={token} via="send" rider={rider} rating={riderRating} onDone={reloadRating} /> : null}

        <section className="wg-card sd-summary">
          <dl className="gg-facts">
            <div><dt>{t("sd_from")}</dt><dd>{send.pickup.name} · {send.pickup.area}</dd></div>
            <div><dt>{t("sd_to")}</dt><dd>{send.drop.name} · {send.drop.area}</dd></div>
            <div><dt>{t("sd_what")}</dt><dd>{t(`sd_kind_${send.kind}` as TKey)} · {t(`sd_size_${send.size}` as TKey)}{send.fragile ? ` · ${t("sd_fragileShort")}` : ""}</dd></div>
            {sender && send.fare != null ? <div><dt>{t("sd_price")}</dt><dd>{rupees(send.fare)} {t("sd_toRider")}{send.feeWaived ? ` · ${t("sd_feeWaivedShort")}` : ` + ${rupees(send.feeRupees ?? 0)}`}</dd></div> : null}
          </dl>
        </section>

        {sender && active ? (
          <div className="sd-actions">
            {shareUrl ? <button type="button" className="wg-btn wg-btn-light" onClick={() => void share()}><Share2 size={16} /> {t("sd_share", { name: send.drop.name })}</button> : null}
            {(send.status === "booked" || send.status === "assigned") ? (
              <button type="button" className="wg-btn wg-btn-ghost" disabled={cancelling}
                onClick={() => { if (window.confirm(t("sd_cancelConfirm"))) { setCancelling(true); void SendService.cancel(token).then(() => SendService.track(token)).then((s) => setSend(s)).finally(() => setCancelling(false)); } }}>
                {t("sd_cancel")}
              </button>
            ) : null}
          </div>
        ) : null}
        {sender ? <p className="wg-fine wg-center"><Camera size={13} /> {t("sd_photoNote")}</p> : null}
      </main>
    </WgFrame>
  );
}
