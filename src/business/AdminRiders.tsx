import { AlertTriangle, LocateFixed, Megaphone, MessageSquareReply, Package, ShieldAlert } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "../components/ui/Button";
import { useT } from "../i18n";
import { LocationService } from "../services/LocationService";
import { rupees } from "./BusinessScreens";
import { BusinessService, type AdminNotice, type AdminTicket, type NoticeKind } from "./BusinessService";

const when = (iso: string) => new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/**
 * The Waggle Send fee. Recorded on every Send from day one, charged only once
 * Gigzen has its own UPI: turning it on without one is refused by the database.
 */
export function SendFeeCard() {
  const t = useT();
  const [fee, setFee] = useState<{ live: boolean; rupees: number; upiId: string | null } | null>(null);
  const [amount, setAmount] = useState("15");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = () => BusinessService.sendFee().then((f) => { setFee(f); setAmount(String(f.rupees)); }).catch(() => undefined);
  useEffect(() => { void load(); }, []);
  async function save(live: boolean) {
    setBusy(true);
    setError("");
    try {
      await BusinessService.setSendFee(live, Number(amount));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("biz_errGeneric"));
    } finally {
      setBusy(false);
    }
  }
  if (!fee) return null;
  return (
    <section className="biz-card">
      <div className="biz-card-head">
        <strong><Package size={16} /> {t("bx_sendFeeTitle")}</strong>
        <span className={`biz-status biz-status-${fee.live ? "verified" : "pending"}`}>{t(fee.live ? "bx_sendFeeLive" : "bx_sendFeeWaived")}</span>
      </div>
      <p className="biz-help">{t(fee.live ? "bx_sendFeeLiveHelp" : "bx_sendFeeWaivedHelp", { upi: fee.upiId ?? "—" })}</p>
      <label className="biz-field"><span>{t("bx_sendFeeAmount")}</span>
        <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" />
      </label>
      {!fee.upiId ? <p className="biz-error">{t("bx_sendFeeNeedsUpi")}</p> : null}
      {error ? <p className="biz-error" role="alert">{error}</p> : null}
      <div className="biz-decide">
        <Button disabled={busy || fee.live || !fee.upiId} onClick={() => void save(true)}>{t("bx_sendFeeTurnOn")}</Button>
        <Button variant="outline" disabled={busy || !fee.live} onClick={() => void save(false)}>{t("bx_sendFeeTurnOff")}</Button>
      </div>
    </section>
  );
}

/**
 * Gigzen's side of the Rider hub: post news, a safety notice or a zone alert
 * (riders online in that zone are told at once), and end it when it is over.
 */
export function AdminNotices() {
  const t = useT();
  const [list, setList] = useState<AdminNotice[]>([]);
  const [kind, setKind] = useState<NoticeKind>("zone_alert");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [area, setArea] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [radius, setRadius] = useState("3");
  const [hours, setHours] = useState("4");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const load = () => BusinessService.adminNotices().then(setList).catch(() => undefined);
  useEffect(() => { void load(); }, []);

  async function here() {
    const p = await LocationService.currentPosition();
    if (!p.fallback) { setLat(p.lat.toFixed(5)); setLng(p.lng.toFixed(5)); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setDone("");
    const zone = kind === "zone_alert";
    if (title.trim().length < 3 || body.trim().length < 3) { setError(t("bx_ntErrText")); return; }
    if (zone && (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng)) || !lat || !lng)) { setError(t("bx_ntErrZone")); return; }
    setBusy(true);
    try {
      await BusinessService.postNotice({
        kind, title, body, area: area || null,
        lat: zone ? Number(lat) : null, lng: zone ? Number(lng) : null, radiusKm: zone ? Number(radius) : null,
        hours: hours ? Number(hours) : null,
      });
      setTitle(""); setBody(""); setArea("");
      setDone(t("bx_ntSent"));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("biz_errGeneric"));
    } finally {
      setBusy(false);
    }
  }

  const live = list.filter((n) => !n.endsAt || new Date(n.endsAt) > new Date());
  return (
    <>
      <form className="biz-card" onSubmit={submit}>
        <div className="biz-card-head"><strong>{t("bx_ntNew")}</strong></div>
        <p className="biz-help">{t("bx_ntHelp")}</p>
        <div className="biz-chips" role="radiogroup">
          {(["zone_alert", "safety", "news"] as NoticeKind[]).map((k) => (
            <button type="button" key={k} role="radio" aria-checked={kind === k} className={`biz-chip${kind === k ? " is-on" : ""}`} onClick={() => setKind(k)}>
              {t(`gg_kind_${k}` as "gg_kind_news")}
            </button>
          ))}
        </div>
        <label className="biz-field"><span>{t("bx_ntTitle")}</span><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={90} placeholder={t("bx_ntTitlePh")} /></label>
        <label className="biz-field"><span>{t("bx_ntBody")}</span><textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={800} rows={3} placeholder={t("bx_ntBodyPh")} /></label>
        {kind === "zone_alert" ? (
          <>
            <label className="biz-field"><span>{t("bx_ntArea")}</span><input value={area} onChange={(e) => setArea(e.target.value)} maxLength={60} placeholder="Rasulgarh flyover" /></label>
            <div className="biz-row3">
              <label className="biz-field"><span>{t("bx_ntLat")}</span><input value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" placeholder="20.2961" /></label>
              <label className="biz-field"><span>{t("bx_ntLng")}</span><input value={lng} onChange={(e) => setLng(e.target.value)} inputMode="decimal" placeholder="85.8245" /></label>
              <label className="biz-field"><span>{t("bx_ntRadius")}</span><input value={radius} onChange={(e) => setRadius(e.target.value)} inputMode="decimal" /></label>
            </div>
            <button type="button" className="biz-link" onClick={() => void here()}><LocateFixed size={15} /> {t("biz_useLocation")}</button>
          </>
        ) : null}
        <label className="biz-field"><span>{t("bx_ntHours")}</span><input value={hours} onChange={(e) => setHours(e.target.value)} inputMode="numeric" placeholder={t("bx_ntHoursPh")} /></label>
        {error ? <p className="biz-error" role="alert">{error}</p> : null}
        {done ? <p className="biz-ok" role="status">{done}</p> : null}
        <Button type="submit" disabled={busy}>{t("bx_ntPost")}</Button>
      </form>

      <section className="biz-card">
        <div className="biz-card-head"><strong>{t("bx_ntLive", { n: String(live.length) })}</strong></div>
        {list.length === 0 ? <p className="biz-help">{t("biz_adminEmpty")}</p> : null}
        <ul className="biz-runs">
          {list.map((n) => {
            const on = !n.endsAt || new Date(n.endsAt) > new Date();
            return (
              <li key={n.id}>
                <strong>
                  {n.kind === "zone_alert" ? <AlertTriangle size={14} /> : n.kind === "safety" ? <ShieldAlert size={14} /> : <Megaphone size={14} />} {n.title}
                </strong>
                <span>{n.body}</span>
                <small>
                  {t(`gg_kind_${n.kind}` as "gg_kind_news")}{n.area ? ` · ${n.area}` : ""}{n.radiusKm ? ` · ${n.radiusKm} km` : ""} · {when(n.createdAt)}
                  {n.endsAt ? ` → ${when(n.endsAt)}` : ""}
                </small>
                {on ? <button type="button" className="biz-link" onClick={() => void BusinessService.endNotice(n.id).then(load)}>{t("bx_ntEnd")}</button> : <small>{t("bx_ntEnded")}</small>}
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}

/** Riders', shops' and customers' requests, with the delivery they name. Answering notifies them. */
export function AdminTickets() {
  const t = useT();
  const [list, setList] = useState<AdminTicket[] | null>(null);
  const [error, setError] = useState("");
  const load = () => BusinessService.ticketQueue().then(setList).catch((err) => setError(err instanceof Error ? err.message : ""));
  useEffect(() => { void load(); }, []);
  if (list === null) return <section className="biz-card"><p className="biz-help">{error || t("biz_loading")}</p></section>;
  if (list.length === 0) return <section className="biz-card"><p className="biz-help">{t("biz_adminEmpty")}</p></section>;
  return <>{list.map((k) => <TicketCard key={k.id} ticket={k} onDone={load} />)}</>;
}

function TicketCard({ ticket: k, onDone }: { ticket: AdminTicket; onDone: () => void }) {
  const t = useT();
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function send(close: boolean) {
    setBusy(true);
    setError("");
    try {
      await BusinessService.replyTicket(k.id, reply, close);
      setReply("");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("biz_errGeneric"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={`biz-card biz-decision${k.status === "open" ? "" : " is-done"}`}>
      <div className="biz-card-head">
        <strong>{k.name ?? "—"} · {t(`gg_topic_${k.topic}` as "gg_topic_payment")}</strong>
        <span className={`biz-status biz-status-${k.status === "open" ? "pending" : "verified"}`}>{t(`gg_tk_${k.status}` as "gg_tk_open")}</span>
      </div>
      <p className="biz-help">{k.app} · {k.phone ?? ""} · {when(k.createdAt)}</p>
      <blockquote className="biz-note">{k.message}</blockquote>
      {k.job ? (
        <div className="biz-facts">
          <div><span>{t("bx_tkJob")}</span><strong>{k.job.shop ?? ""} → {k.job.dropoff} · {rupees(k.job.payout)}</strong></div>
          <div><span>{t("bx_tkPay")}</span><strong>
            {k.job.rider_pay_disputed_at ? t("bx_tkDisputed", { utr: k.job.rider_pay_utr ?? "" })
              : k.job.rider_paid_at ? t("bx_tkPaid", { utr: k.job.rider_pay_utr ?? "" }) : t("bx_tkUnpaid")}
          </strong></div>
        </div>
      ) : null}
      {k.reply ? <p className="biz-ok"><MessageSquareReply size={15} /> {k.reply}</p> : null}
      {k.status !== "closed" ? (
        <>
          <label className="biz-field"><span>{t("bx_tkReply")}</span><textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2} maxLength={1000} /></label>
          {error ? <p className="biz-error" role="alert">{error}</p> : null}
          <div className="biz-decide">
            <Button disabled={busy || reply.trim().length < 2} onClick={() => void send(false)}>{t("bx_tkSend")}</Button>
            <Button variant="outline" disabled={busy || reply.trim().length < 2} onClick={() => void send(true)}>{t("bx_tkSendClose")}</Button>
          </div>
        </>
      ) : null}
    </section>
  );
}
