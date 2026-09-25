import { AlertTriangle, BadgeCheck, ChevronRight, Clock3, Map as MapIcon, Radar, ShieldCheck, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Circle, CircleMarker, MapContainer, Tooltip, useMap } from "react-leaflet";
import { useNavigate } from "react-router-dom";
import { JobCard } from "../components/JobCard";
import { VectorBasemap } from "../components/VectorBasemap";
import { Button } from "../components/ui/Button";
import { useBrandBand } from "../hooks/useBrandBand";
import { useT } from "../i18n";
import { useAuthStore } from "../stores/useAuthStore";
import { useAvailabilityStore } from "../stores/useAvailabilityStore";
import { JOB_RADIUS_KM, useJobStore } from "../stores/useJobStore";
import { useLocationStore } from "../stores/useLocationStore";
import { useNotificationStore } from "../stores/useNotificationStore";
import { useVerificationStore } from "../stores/useVerificationStore";
import type { Job } from "../types";
import { currency, initials } from "../utils/format";
import { GigService, istDay, type Earnings, type Notice } from "./GigService";
import { hoursMinutes } from "./gigFormat";

/** How long a new offer stays on screen before it is dismissed for this rider. */
export const OFFER_SECONDS = 45;

/**
 * Waggle Gig's first screen. Work first: the switch, the job in hand, the
 * offers, a live map of where the work is. Today's real money sits under the
 * switch, measured from delivered jobs, never estimated.
 */
export function GigHome() {
  const t = useT();
  const navigate = useNavigate();
  useBrandBand("home");
  const user = useAuthStore((s) => s.user);
  const jobs = useJobStore((s) => s.jobs);
  const dismissed = useJobStore((s) => s.dismissed);
  const verification = useVerificationStore((s) => s.verification);
  const loadVerification = useVerificationStore((s) => s.load);
  const online = useAvailabilityStore((s) => s.online);
  const switching = useAvailabilityStore((s) => s.busy);
  const goOnline = useAvailabilityStore((s) => s.goOnline);
  const goOffline = useAvailabilityStore((s) => s.goOffline);
  const here = useLocationStore((s) => s.currentLocation);
  const notificationCount = useNotificationStore((s) => s.notifications.length);
  const [today, setToday] = useState<Earnings | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [now, setNow] = useState(Date.now());

  const verified = verification?.status === "verified";
  const running = jobs.filter((j) => j.status === "accepted" || j.status === "picked_up");
  const offers = online && verified && running.length === 0
    ? jobs.filter((j) => j.status === "open" && !dismissed.includes(j.id) && !isSnoozed(j.id, now)).slice(0, 3)
    : [];
  const doneToday = jobs.filter((j) => j.status === "completed").length;

  useEffect(() => { if (user) void loadVerification(user.id); }, [user, loadVerification]);

  // Today's money, and refreshed whenever a job finishes.
  useEffect(() => {
    let live = true;
    const d = istDay();
    GigService.earnings(d, d).then((e) => live && setToday(e)).catch(() => undefined);
    return () => { live = false; };
  }, [doneToday, online]);

  // Zone alerts and notices where the rider is.
  useEffect(() => {
    let live = true;
    const load = () => GigService.hub(here.fallback ? undefined : here.lat, here.fallback ? undefined : here.lng)
      .then((n) => live && setNotices(n)).catch(() => undefined);
    void load();
    const timer = window.setInterval(load, 5 * 60 * 1000);
    return () => { live = false; window.clearInterval(timer); };
    // Again whenever a notification arrives: a zone alert shows here the moment Gigzen posts it.
  }, [here.fallback, Math.round(here.lat * 50), Math.round(here.lng * 50), notificationCount]); // eslint-disable-line react-hooks/exhaustive-deps

  // Offers time out on this phone; the job stays open for other riders. The
  // clock runs only while the rider can see the screen: an offer that arrived
  // while the app was in the background starts its 45 seconds when they look.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") pauseOffers(1000);
      setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    // Timed out: rested for two minutes, then offered again if nobody took it.
    // Only Skip hides an offer for good (declineJob).
    for (const job of offers) if (offerSecondsLeft(job.id, now) <= 0) snoozeOffer(job.id);
  }, [now]); // eslint-disable-line react-hooks/exhaustive-deps

  const alert = notices.find((n) => n.kind === "zone_alert");
  const hour = new Date().getHours();
  const greet = t(hour < 12 ? "greet_morning" : hour < 18 ? "greet_afternoon" : "greet_evening");

  return (
    <main className="page-shell home-native gg-home">
      <section className="home-band gg-band">
        <div className="home-hero">
          <div className="home-hero-text">
            <p>{greet}</p>
            <h2>{user?.fullName ?? ""}</h2>
          </div>
          <button type="button" className="home-hero-avatar" onClick={() => navigate("/profile")} aria-label={t("nav_profile")}>
            {initials(user?.fullName ?? "W")}
          </button>
        </div>

        <button
          type="button"
          className={`gg-switch${online ? " is-on" : ""}`}
          onClick={() => void (online ? goOffline() : goOnline())}
          disabled={switching || (!verified && !online)}
          aria-pressed={online}
        >
          <span className="gg-switch-knob" aria-hidden><Radar size={20} /></span>
          <span className="gg-switch-text">
            <strong>{t(online ? "gg_online" : "gg_offline")}</strong>
            <small>{t(online ? (running.length ? "gg_onlineBusy" : "gg_onlineLooking") : verified ? "gg_offlineSub" : "gg_needVerified")}</small>
          </span>
          <span className="gg-switch-action">{t(online ? "avail_goOffline" : "avail_goOnline")}</span>
        </button>

        <button type="button" className="gg-today" onClick={() => navigate("/earnings")}>
          <span><b>{currency(today?.fare ?? 0)}</b><small>{t("gg_todayEarned")}</small></span>
          <span><b>{today?.deliveries ?? 0}</b><small>{t("gg_todayDeliveries")}</small></span>
          <span><b>{hoursMinutes(today?.onlineMinutes ?? 0)}</b><small>{t("gg_todayOnline")}</small></span>
          <ChevronRight size={18} aria-hidden />
        </button>
      </section>

      {alert ? (
        <button type="button" className="gg-alert" onClick={() => navigate("/community?tab=hub")}>
          <AlertTriangle size={18} />
          <span><strong>{alert.title}</strong><small>{alert.body}</small></span>
        </button>
      ) : null}

      {verification !== undefined && !verified ? (
        <section className="dashboard-card glass-card gg-verify">
          <ShieldCheck size={26} />
          <div>
            <strong>{t(verification?.status === "pending" ? "ver_pendingTitle" : verification?.status === "rejected" ? "ver_rejectedTitle" : verification?.status === "suspended" ? "ver_suspendedTitle" : "ver_cardTitle")}</strong>
            <p>{verification?.status === "rejected" && verification.reviewNote ? verification.reviewNote : t(verification?.status === "pending" ? "ver_pendingBody" : verification?.status === "suspended" ? "ver_suspendedBody" : "ver_cardBody")}</p>
          </div>
          {verification?.status == null || verification.status === "rejected" ? (
            <Button onClick={() => navigate("/verify")}>{t(verification?.status === "rejected" ? "ver_fix" : "ver_cardButton")}</Button>
          ) : null}
        </section>
      ) : null}

      {running.length ? (
        <section className="gg-group">
          <h3 className="jobs-group-title">{t("gg_current")}</h3>
          {running.map((job) => <JobCard key={job.id} job={job} here={here.fallback ? null : here} />)}
        </section>
      ) : null}

      {offers.length ? (
        <section className="gg-group">
          <h3 className="jobs-group-title">{t("gg_offers")}</h3>
          {offers.map((job) => (
            <JobCard key={job.id} job={job} here={here.fallback ? null : here} secondsLeft={offerSecondsLeft(job.id, now)} totalSeconds={OFFER_SECONDS} />
          ))}
        </section>
      ) : null}

      <section className="dashboard-card glass-card gg-mapcard">
        <div className="gg-card-head">
          <h3><MapIcon size={18} /> {t(online ? "gg_mapOnline" : "gg_mapTitle")}</h3>
          {online && !running.length && !offers.length ? <span className="gg-pulse">{t("gg_searching")}</span> : null}
        </div>
        <WorkMap here={here.fallback ? null : here} jobs={online ? [...running, ...jobs.filter((j) => j.status === "open")] : running} />
        <p className="micro-copy">
          {here.fallback ? t("gg_mapNoGps") : online ? t("gg_mapHelpOnline", { km: String(JOB_RADIUS_KM) }) : t("gg_mapHelpOffline")}
        </p>
      </section>

      {!online && verified && !running.length ? (
        <section className="dashboard-card glass-card gg-tips">
          <h3><BadgeCheck size={18} /> {t("gg_howTitle")}</h3>
          <ol>
            <li>{t("gg_how1")}</li>
            <li>{t("gg_how2")}</li>
            <li>{t("gg_how3")}</li>
            <li>{t("gg_how4")}</li>
          </ol>
        </section>
      ) : null}

      {today && (today.shopWaiting > 0 || today.shopDisputed > 0) ? (
        <button type="button" className="dashboard-card glass-card gg-owed" onClick={() => navigate("/earnings")}>
          <Wallet size={20} />
          <span>
            <strong>{t("gg_waitingPay", { amount: currency(today.shopWaiting + today.shopDisputed) })}</strong>
            <small>{t("gg_waitingPaySub")}</small>
          </span>
          <ChevronRight size={18} />
        </button>
      ) : null}

      <p className="gg-foot"><Clock3 size={14} /> {t("gg_foot")}</p>
    </main>
  );
}

/* ------------------------------------------------------------------ offer timer */

const firstSeen = new Map<string, number>();
/** Offers that timed out, and when they may come back. */
const snoozed = new Map<string, number>();
const SNOOZE_MS = 2 * 60 * 1000;

function snoozeOffer(jobId: string) {
  firstSeen.delete(jobId);
  snoozed.set(jobId, Date.now() + SNOOZE_MS);
}

function isSnoozed(jobId: string, now: number) {
  const until = snoozed.get(jobId);
  if (until == null) return false;
  if (until > now) return true;
  snoozed.delete(jobId);
  return false;
}

/** The screen is hidden: hold every offer's clock where it is. */
function pauseOffers(ms: number) {
  for (const [id, at] of firstSeen) firstSeen.set(id, at + ms);
}

/** Seconds left on an offer, counted from when this phone first showed it. */
export function offerSecondsLeft(jobId: string, now = Date.now()): number {
  // The real time it first appeared, not `now`: that is the last tick of a clock
  // that only runs while offers are on screen, so it can be long stale, and a
  // fresh offer then opened with a fraction of its time already gone.
  if (!firstSeen.has(jobId)) firstSeen.set(jobId, Date.now());
  return Math.max(0, OFFER_SECONDS - Math.floor((now - (firstSeen.get(jobId) ?? now)) / 1000));
}

/* ------------------------------------------------------------------ the work map */

function Frame({ here, points }: { here: { lat: number; lng: number } | null; points: [number, number][] }) {
  const map = useMap();
  const key = points.map((p) => p.join(",")).join("|") + (here ? `${here.lat.toFixed(3)},${here.lng.toFixed(3)}` : "");
  useEffect(() => {
    const all: [number, number][] = [...points, ...(here ? [[here.lat, here.lng] as [number, number]] : [])];
    if (all.length >= 2) map.fitBounds(all, { padding: [30, 30], maxZoom: 15 });
    else if (all.length === 1) map.setView(all[0], 14);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** The rider, the pickups of the work around them, and where work usually comes from. */
function WorkMap({ here, jobs }: { here: { lat: number; lng: number } | null; jobs: Job[] }) {
  const t = useT();
  const [busy, setBusy] = useState<{ lat: number; lng: number; pickups: number }[]>([]);
  useEffect(() => {
    if (!here) return;
    let live = true;
    GigService.demand(here.lat, here.lng).then((d) => live && setBusy(d)).catch(() => undefined);
    return () => { live = false; };
  }, [here ? Math.round(here.lat * 100) : null, here ? Math.round(here.lng * 100) : null]); // eslint-disable-line react-hooks/exhaustive-deps
  const most = Math.max(1, ...busy.map((b) => b.pickups));
  const pickups = useMemo(
    () => jobs.filter((j) => j.pickupLat != null && j.pickupLng != null).map((j) => ({ job: j, at: [j.pickupLat!, j.pickupLng!] as [number, number] })),
    [jobs],
  );
  const center: [number, number] = here ? [here.lat, here.lng] : pickups[0]?.at ?? [20.2961, 85.8245];
  return (
    <div className="gg-map">
      <MapContainer center={center} zoom={13} zoomControl={false} attributionControl={false} scrollWheelZoom={false} style={{ height: "100%" }}>
        <VectorBasemap />
        <Frame here={here} points={pickups.map((p) => p.at)} />
        {busy.map((b) => (
          <Circle key={`${b.lat},${b.lng}`} center={[b.lat, b.lng]} radius={350 + 250 * (b.pickups / most)}
            pathOptions={{ stroke: false, fillColor: "#f97316", fillOpacity: 0.08 + 0.17 * (b.pickups / most) }}>
            <Tooltip direction="top">{t("gg_busyArea", { n: String(b.pickups) })}</Tooltip>
          </Circle>
        ))}
        {here ? (
          <>
            <Circle center={[here.lat, here.lng]} radius={JOB_RADIUS_KM * 1000} pathOptions={{ color: "#4F46E5", weight: 1, opacity: 0.35, fillColor: "#4F46E5", fillOpacity: 0.04 }} />
            <CircleMarker center={[here.lat, here.lng]} radius={9} pathOptions={{ color: "#fff", weight: 3, fillColor: "#111827", fillOpacity: 1 }}>
              <Tooltip direction="top" offset={[0, -8]}>{t("gg_you")}</Tooltip>
            </CircleMarker>
          </>
        ) : null}
        {pickups.map(({ job, at }) => (
          <CircleMarker key={job.id} center={at} radius={job.status === "open" ? 9 : 11}
            pathOptions={{ color: "#fff", weight: 3, fillColor: job.status === "open" ? "#F59E0B" : "#4F46E5", fillOpacity: 1 }}>
            <Tooltip direction="top" offset={[0, -8]}>{job.pickup.split(",")[0]} · {currency(job.payout)}</Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
