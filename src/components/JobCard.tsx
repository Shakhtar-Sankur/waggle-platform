import { Camera, CheckCircle2, Clock, MapPin, Navigation, Package, Phone, Siren, Store } from "lucide-react";
import { MediaService } from "../services/MediaService";
import { useEffect, useState, type FormEvent } from "react";
import { NavMap } from "../maps/NavMap";
import { useJobStore, type StepAnswer } from "../stores/useJobStore";
import { SupabaseService } from "../services/SupabaseService";
import { GigService, type SendDetails, type ShopContact } from "../gig/GigService";
import { kmBetween } from "../gig/gigFormat";
import type { Job } from "../types";
import { currency, km } from "../utils/format";
import { Button } from "./ui/Button";
import { useT, type TKey } from "../i18n";

const ANSWER: Partial<Record<StepAnswer, TKey>> = {
  wrong: "job_codeWrong",
  locked: "job_codeLocked",
  not_yours: "job_notYours",
  too_late: "job_tooLate",
  error: "job_stepError",
  offline: "job_stepError",
};

/**
 * One Waggle job, at whatever step it is:
 *   open       → the offer: fare, how far the pickup is, the trip, a countdown; Accept or Skip
 *   accepted   → go to the shop (call it, navigate), enter the pickup code the shop gives you, or hand it back
 *   picked_up  → the full address and the road route; enter the code the customer gives you
 *   completed  → what it paid
 */
export function JobCard({
  job,
  here,
  secondsLeft,
  totalSeconds,
}: {
  job: Job;
  /** The rider's position, for "pickup 1.2 km away". */
  here?: { lat: number; lng: number } | null;
  /** On an offer: seconds before it leaves this phone. */
  secondsLeft?: number;
  totalSeconds?: number;
}) {
  const t = useT();
  const acceptJob = useJobStore((state) => state.acceptJob);
  const declineJob = useJobStore((state) => state.declineJob);
  const confirmPickup = useJobStore((state) => state.confirmPickup);
  const confirmDelivery = useJobStore((state) => state.confirmDelivery);
  const releaseJob = useJobStore((state) => state.releaseJob);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [details, setDetails] = useState<{ address: string; note: string | null; lat: number; lng: number } | null>(null);
  const [shop, setShop] = useState<ShopContact | null>(null);
  const [parcel, setParcel] = useState<SendDetails | null>(null);
  const [shooting, setShooting] = useState(false);
  const isSend = job.source === "send";
  const address = details?.address ?? null;
  const holding = job.status === "accepted" || job.status === "picked_up";

  // The customer's full address and the shop's contact arrive only once this worker holds the job.
  useEffect(() => {
    if (!holding) return;
    let live = true;
    void SupabaseService.loadJobDetails(job.id).then((d) => live && setDetails(d));
    if (job.businessId) void GigService.shopContact(job.id).then((s) => live && setShop(s)).catch(() => undefined);
    if (isSend) void GigService.sendDetails(job.id).then((d) => live && setParcel(d)).catch(() => undefined);
    return () => { live = false; };
  }, [job.id, holding, job.businessId, isSend]);

  async function photograph() {
    const picked = await MediaService.pickImage();
    if (!picked) return;
    setShooting(true);
    setMessage("");
    try {
      await GigService.uploadParcelPhoto(job.id, picked.full);
      setParcel((p) => (p ? { ...p, photoTaken: true } : p));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t("job_stepError"));
    } finally {
      setShooting(false);
    }
  }

  const navigateTo =
    job.status === "accepted" && job.pickupLat != null && job.pickupLng != null ? { lat: job.pickupLat, lng: job.pickupLng }
      : job.status === "picked_up" && details ? { lat: details.lat, lng: details.lng }
      : null;
  const toPickup = here && job.pickupLat != null && job.pickupLng != null ? kmBetween(here, { lat: job.pickupLat, lng: job.pickupLng }) : null;

  async function run(action: () => Promise<StepAnswer>) {
    setBusy(true);
    setMessage("");
    const answer = await action();
    setBusy(false);
    if (answer === "ok") setCode("");
    else setMessage(t(ANSWER[answer] ?? "job_stepError"));
  }

  function submitCode(event: FormEvent) {
    event.preventDefault();
    if (code.length !== 4 || busy) return;
    void run(() => (job.status === "accepted" ? confirmPickup(job.id, code) : confirmDelivery(job.id, code)));
  }

  // Where the rider is in the job: 0 heading to the shop, 2 heading to the customer.
  const step = job.status === "picked_up" ? 2 : 0;
  const steps: TKey[] = ["gg_stepShop", "gg_stepPickup", "gg_stepCustomer", "gg_stepDeliver"];

  return (
    <article className={`job-card job-${job.status}${job.status === "open" ? " gg-offer" : ""}`}>
      {job.status === "open" && secondsLeft != null && totalSeconds ? (
        <div className="gg-timer" role="timer" aria-label={t("gg_offerLeft", { s: String(secondsLeft) })}>
          <span style={{ width: `${(secondsLeft / totalSeconds) * 100}%` }} />
          <small>{t("gg_offerLeft", { s: String(secondsLeft) })}</small>
        </div>
      ) : null}

      <div className="job-card-top">
        <div>
          <span className="pill">{isSend ? <><Package size={14} /> {t("gg_parcelJob")}</> : <><Store size={14} /> {job.businessId ? t("gg_shopJob") : "Waggle"}</>}</span>
          <h4>{job.title}</h4>
        </div>
        <strong className="gg-fare">{currency(job.payout)}<small>{t("gg_allYours")}</small></strong>
      </div>

      {holding ? (
        <ol className="gg-steps" aria-label={t(job.status === "accepted" ? "job_stageAccepted" : "job_stagePickedUp")}>
          {steps.map((key, i) => (
            <li key={key} className={i < step ? "is-done" : i === step || i === step + 1 ? "is-now" : ""}>
              <span>{i < step ? <CheckCircle2 size={14} /> : i + 1}</span>{t(key)}
            </li>
          ))}
        </ol>
      ) : null}

      <div className="job-stops">
        <div className={job.status === "picked_up" ? "is-done" : ""}>
          <Store size={16} />
          <span>
            <small>{t("job_pickupFrom")}{toPickup != null && job.status !== "picked_up" ? ` · ${t("gg_away", { km: toPickup.toFixed(1) })}` : ""}</small>
            {shop?.name ? <b>{shop.name}</b> : null}
            {shop?.address ?? job.pickup}
          </span>
        </div>
        <div>
          <MapPin size={16} />
          <span>
            <small>{t("job_deliverTo")}</small>
            {holding && address ? address : job.status === "open" ? t("job_areaOnly", { area: job.dropoff }) : job.dropoff}
          </span>
        </div>
      </div>
      {job.note && holding ? <p className="job-note">{job.note}</p> : null}
      {isSend && holding && parcel ? (
        <div className="gg-parcel">
          <div className="gg-parcel-people">
            <a href={`tel:${parcel.pickupPhone}`}><Phone size={14} /> <span><small>{t("gg_parcelFrom")}</small>{parcel.pickupName}</span></a>
            <a href={`tel:${parcel.dropPhone}`}><Phone size={14} /> <span><small>{t("gg_parcelTo")}</small>{parcel.dropName}</span></a>
          </div>
          {job.status === "accepted" ? <p className="gg-parcel-collect">{t("gg_parcelCollect", { fare: currency(parcel.fare), name: parcel.pickupName })}</p> : null}
          {job.status === "accepted" ? (
            parcel.photoTaken
              ? <p className="gg-parcel-photo is-done"><CheckCircle2 size={15} /> {t("gg_parcelPhotoDone")}</p>
              : <button type="button" className="gg-parcel-photo" onClick={() => void photograph()} disabled={shooting}><Camera size={16} /> {shooting ? t("gg_parcelPhotoSaving") : t("gg_parcelPhoto")}</button>
          ) : null}
        </div>
      ) : null}
      {details?.note && details.note !== job.note && job.status === "picked_up" ? <p className="job-note">{details.note}</p> : null}
      {/* Turn-by-turn to the shop, then to the customer. */}
      {job.status === "accepted" && job.pickupLat != null && job.pickupLng != null ? (
        <NavMap key="to-shop" to={{ lat: job.pickupLat, lng: job.pickupLng }} toLabel={shop?.name ?? job.pickup.split(",")[0]} />
      ) : null}
      {job.status === "picked_up" && details ? <NavMap key="to-door" to={{ lat: details.lat, lng: details.lng }} toLabel={job.dropoff} /> : null}

      <div className="job-meta">
        <span><Clock size={15} /> {job.etaMinutes} min</span>
        <span>{t("gg_trip", { km: km(job.distanceKm) })}</span>
        {navigateTo ? (
          <a className="job-directions" href={`https://www.google.com/maps/dir/?api=1&destination=${navigateTo.lat},${navigateTo.lng}&travelmode=driving`} target="_blank" rel="noreferrer">
            <Navigation size={14} /> {t("job_navigate")}
          </a>
        ) : null}
      </div>

      {holding ? (
        <div className="gg-contact">
          {shop?.phone ? <a href={`tel:${shop.phone.replace(/\s/g, "")}`}><Phone size={15} /> {t("gg_callShop")}</a> : null}
          <a className="gg-sos" href="tel:112" onClick={(e) => { if (!window.confirm(t("gg_sosConfirm"))) e.preventDefault(); }}>
            <Siren size={15} /> {t("gg_sos")}
          </a>
        </div>
      ) : null}

      {job.status === "open" ? (
        <div className="job-actions">
          <Button variant="outline" onClick={() => declineJob(job.id)}>{t("gg_skip")}</Button>
          <Button onClick={() => void acceptJob(job.id)}>{t("job_accept")} · {currency(job.payout)}</Button>
        </div>
      ) : holding ? (
        <form className="job-code" onSubmit={submitCode}>
          <label>
            <span>{t(job.status === "accepted" ? "job_pickupCodeLabel" : "job_deliveryCodeLabel")}</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="• • • •"
              aria-label={t(job.status === "accepted" ? "job_pickupCodeLabel" : "job_deliveryCodeLabel")}
            />
          </label>
          {message ? <p className="job-message" role="alert">{message}</p> : null}
          <div className="job-actions">
            {job.status === "accepted" ? (
              <Button type="button" variant="outline" disabled={busy} onClick={() => void run(() => releaseJob(job.id))}>{t("job_handBack")}</Button>
            ) : null}
            <Button type="submit" disabled={busy || code.length !== 4 || (isSend && job.status === "accepted" && !parcel?.photoTaken)}>
              {t(job.status === "accepted" ? "job_confirmPickup" : "job_confirmDelivery")}
            </Button>
          </div>
        </form>
      ) : job.status === "completed" ? (
        <p className="job-done"><CheckCircle2 size={16} /> {t("biz_jobCompleted")}</p>
      ) : null}
    </article>
  );
}
