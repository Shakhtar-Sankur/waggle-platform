import { Briefcase, CheckCircle2, Clock3, MapPin, Settings, ShieldCheck, TrendingUp, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { JobCard } from "../components/JobCard";
import { WorkAppMark } from "../components/WorkAppMark";
import { WorkAppPicker } from "../components/WorkAppPicker";
import { Button } from "../components/ui/Button";
import { APP_NAME } from "../config/constants";
import { useBrandBand } from "../hooks/useBrandBand";
import { useT } from "../i18n";
import { useAuthStore } from "../stores/useAuthStore";
import { useAvailabilityStore } from "../stores/useAvailabilityStore";
import { useConsentStore } from "../stores/useConsentStore";
import { useJobStore } from "../stores/useJobStore";
import { useLocationStore } from "../stores/useLocationStore";
import { useProfileStore } from "../stores/useProfileStore";
import { useVerificationStore } from "../stores/useVerificationStore";
import { currency, currencyPrecise, duration, initials } from "../utils/format";
import { getWorkApp, workAppLabel } from "../utils/workApps";

/**
 * The work tab, and the app's first screen: the driver's day and their jobs in
 * one place. It replaces the old Home screen, which showed the same distance,
 * time and earnings one tab away from the job list they belong to.
 *
 * The two job lists are deliberately kept apart. "Waggle jobs" are jobs Waggle
 * itself dispatched — there are none until the marketplace runs, and the empty
 * state says so rather than inventing any. The platform picker at the top is
 * the other kind of work: jobs the driver takes on somebody else's app, which
 * Waggle records but does not send. One control, at the top, for that choice —
 * repeating it lower down was a second button for a job already done.
 */
export function JobsScreen() {
  const navigate = useNavigate();
  const t = useT();
  const user = useAuthStore((state) => state.user);
  const [showPicker, setShowPicker] = useState(false);
  const consented = useConsentStore((state) => state.accepted);
  const [showSplash, setShowSplash] = useState(() => sessionStorage.getItem("masaya_splash") !== "shown");
  const jobs = useJobStore((state) => state.jobs);
  const dismissed = useJobStore((state) => state.dismissed);
  const verification = useVerificationStore((state) => state.verification);
  const loadVerification = useVerificationStore((state) => state.load);
  const online = useAvailabilityStore((state) => state.online);
  const switching = useAvailabilityStore((state) => state.busy);
  const goOnline = useAvailabilityStore((state) => state.goOnline);
  const goOffline = useAvailabilityStore((state) => state.goOffline);
  const activeApp = useProfileStore((state) => state.activeApp);
  const baseRate = useProfileStore((state) => state.baseRate);
  const dailyGoal = useProfileStore((state) => state.dailyGoal);
  const homeAddress = useProfileStore((state) => state.homeAddress);
  const currencyCode = useProfileStore((state) => state.currencyCode);
  const totalDistanceKm = useLocationStore((state) => state.totalDistanceKm);
  const elapsedMinutes = useLocationStore((state) => state.elapsedMinutes);
  const isTracking = useLocationStore((state) => state.isTracking);
  const startTracking = useLocationStore((state) => state.startTracking);
  const stopTracking = useLocationStore((state) => state.stopTracking);

  const app = getWorkApp(activeApp);
  const earnings = totalDistanceKm * baseRate;
  const goalProgress = Math.min(100, Math.round((earnings / dailyGoal) * 100));
  const deliveringStarted = isTracking || totalDistanceKm > 0;
  const perHour = elapsedMinutes >= 1 ? earnings / (elapsedMinutes / 60) : 0;
  const hour = new Date().getHours();
  const greetKey = hour < 12 ? "greet_morning" : hour < 18 ? "greet_afternoon" : "greet_evening";
  const verified = verification?.status === "verified";
  const offered = online && verified ? jobs.filter((job) => job.status === "open" && !dismissed.includes(job.id)) : [];
  const running = jobs.filter((job) => job.status === "accepted" || job.status === "picked_up");
  const startOfDay = new Date().setHours(0, 0, 0, 0);
  const doneToday = jobs.filter((job) => job.status === "completed" && (job.deliveredAt ?? 0) >= startOfDay);
  const earnedToday = doneToday.reduce((sum, job) => sum + job.payout, 0);
  // Shop jobs are paid by the shop, straight to the worker's UPI. The last two weeks of them.
  const twoWeeks = Date.now() - 14 * 864e5;
  const shopPay = jobs.filter((job) => job.status === "completed" && job.businessId && (job.deliveredAt ?? 0) >= twoWeeks);
  const reportUnpaid = useJobStore((state) => state.reportUnpaid);

  useEffect(() => {
    if (user) void loadVerification(user.id);
  }, [user, loadVerification]);

  // Consent is a gate; nothing else opens in front of it.
  useEffect(() => {
    if (!activeApp && consented) setShowPicker(true);
  }, [activeApp, consented]);

  useBrandBand("home");

  useEffect(() => {
    if (!showSplash) return;
    const timer = window.setTimeout(() => {
      sessionStorage.setItem("masaya_splash", "shown");
      setShowSplash(false);
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [showSplash]);

  /* Work first, money last.
     A driver opens this app to find or finish a job, not to read today's totals,
     so the lists sit at the top and the day's figures close the screen. */
  const jobLists = (
    <>
      {running.length ? (
        <section className="jobs-group">
          <h3 className="jobs-group-title">{t("jobs_running")}</h3>
          {running.map((job) => <JobCard key={job.id} job={job} />)}
        </section>
      ) : null}

      <section className="jobs-group">
        <h3 className="jobs-group-title">{t("jobs_waggle")}</h3>
        {verification !== undefined && !verified ? (
          <VerifyCard status={verification?.status ?? null} note={verification?.reviewNote ?? null} onOpen={() => navigate("/verify")} />
        ) : offered.length ? (
          offered.map((job) => <JobCard key={job.id} job={job} />)
        ) : (
          <div className="dashboard-card glass-card income-empty">
            <span className="income-empty-icon"><Briefcase size={28} /></span>
            <strong>{t(online ? "jobs_emptyTitle" : "jobs_offlineTitle")}</strong>
            <p>
              {online
                ? app ? t("jobs_emptyBodyApp", { app: workAppLabel(app) }) : t("jobs_emptyBody")
                : t("jobs_offlineBody")}
            </p>
          </div>
        )}
      </section>

      {doneToday.length ? (
        <section className="dashboard-card glass-card waggle-earned">
          <div>
            <span>{t("job_doneToday")}</span>
            <strong>{currency(earnedToday)}</strong>
          </div>
          <small>{t("job_doneCount", { count: String(doneToday.length) })}</small>
        </section>
      ) : null}

      {shopPay.length ? (
        <section className="dashboard-card glass-card shop-pay">
          <h3 className="jobs-group-title">{t("job_payTitle")}</h3>
          <p className="micro-copy">{t("job_payHelp")}</p>
          <ul>
            {shopPay.map((job) => (
              <li key={job.id} className={job.riderPayDisputedAt ? "is-disputed" : job.riderPaidAt ? "is-paid" : ""}>
                <div>
                  <strong>{job.dropoff}</strong>
                  <small>
                    {job.riderPayDisputedAt ? t("job_payDisputed")
                      : job.riderPaidAt ? t("job_payPaid", { utr: job.riderPayUtr ?? "" })
                      : t("job_payWaiting")}
                  </small>
                </div>
                <b>{job.riderPaidAt && !job.riderPayDisputedAt ? <CheckCircle2 size={15} /> : null} {currency(job.payout)}</b>
                {job.riderPaidAt && !job.riderPayDisputedAt ? (
                  <button type="button" className="shop-pay-report" onClick={() => { if (window.confirm(t("job_payConfirm"))) void reportUnpaid(job.id); }}>
                    {t("job_payNotReceived")}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );

  return (
    <main className="page-shell home-native" data-currency={currencyCode}>
      {showSplash ? (
        <div className="splash-screen">
          <div className="splash-avatar">{initials(user?.fullName ?? APP_NAME)}</div>
          <h1>{APP_NAME}</h1>
          <p>{t("auth_tagline")}</p>
          <div className="splash-dots"><span /><span /><span /></div>
        </div>
      ) : null}

      <section className="home-band">
        <div className="home-hero">
          <div className="home-hero-text">
            <p>{t(greetKey)}</p>
            <h2>{t("home_hello")}, {user?.fullName ?? "Driver"}</h2>
          </div>
          <div className="home-hero-avatar">{initials(user?.fullName ?? "Driver")}</div>
        </div>

        {/* Online asks Waggle for work. It is not the shift tracker below, and
            neither switch turns the other on. */}
        <button
          className={`online-switch ${online ? "on" : ""}`}
          onClick={() => void (online ? goOffline() : goOnline())}
          disabled={switching}
          aria-pressed={online}
        >
          <span className="online-dot" aria-hidden />
          <span className="online-text">
            <strong>{t(online ? "avail_online" : "avail_offline")}</strong>
            <small>{t(online ? "avail_onlineSub" : "avail_offlineSub")}</small>
          </span>
          <span className="online-action">{t(online ? "avail_goOffline" : "avail_goOnline")}</span>
        </button>

        {/* The one place a driver chooses the platform today's work is recorded
            against. A second picker lower down the screen was the same control
            twice. */}
        <button className="working-app-card" onClick={() => setShowPicker(true)}>
          <span>{t("home_workingApp")}</span>
          {app ? (
            <strong><WorkAppMark app={app} size={20} /> {workAppLabel(app)} <small>{t("common_change")}</small></strong>
          ) : (
            <strong>{t("home_selectApp")} →</strong>
          )}
        </button>
      </section>

      {jobLists}

      <section className="dashboard-card glass-card journey-card">
        <div className="section-heading">
          <div>
            <h3><MapPin size={19} /> {t("home_journey")}</h3>
            <p>{homeAddress || t("home_setAddress")}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("a11y_journeySettings")}
            onClick={() => navigate("/profile?settings=true")}
          >
            <Settings size={18} />
          </Button>
        </div>
        <div className="stat-grid">
          <Stat icon={<MapPin size={22} />} value={totalDistanceKm.toFixed(1)} label={t("stat_kmToday")} />
          <Stat icon={<Clock3 size={22} />} value={duration(elapsedMinutes)} label={t("stat_activeTime")} />
          <Stat icon={<Wallet size={22} />} value={currencyPrecise(earnings)} label={t("stat_earnings")} highlight />
        </div>
        <p className="micro-copy" dir="auto">{t("home_rateLine", { rate: currencyPrecise(baseRate) })}</p>
        <div className="tracking-actions">
          <Button onClick={() => (isTracking ? stopTracking() : void startTracking())}>
            {isTracking ? t("home_stopTracking") : t("home_startTracking")}
          </Button>
        </div>
      </section>

      {deliveringStarted ? (
        <section className="dashboard-card glass-card income-card">
          <div className="section-heading">
            <div>
              <h3><TrendingUp size={19} /> {t("income_title")}</h3>
              <p>{t(isTracking ? "income_live" : "income_sinceToday")}</p>
            </div>
            {isTracking ? <span className="live-pill">● LIVE</span> : null}
          </div>
          <div className="income-amount">{currencyPrecise(earnings)}</div>
          <div className="income-metrics">
            <div className="income-metric">
              <span><Clock3 size={18} /></span>
              <strong>{elapsedMinutes >= 1 ? currencyPrecise(perHour) : "—"}</strong>
              <small>{t("income_perHour")}</small>
            </div>
            {isTracking ? (
              <>
                <div className="income-metric">
                  <span><MapPin size={18} /></span>
                  <strong>{totalDistanceKm.toFixed(1)} km</strong>
                  <small>{t("income_delivered")}</small>
                </div>
                <div className="income-metric">
                  <span><Wallet size={18} /></span>
                  <strong>{currencyPrecise(baseRate)}</strong>
                  <small>{t("income_perKm")}</small>
                </div>
              </>
            ) : null}
          </div>
          <div className="income-goal">
            <div className="progress-track"><span style={{ width: `${goalProgress}%` }} /></div>
            <p className="micro-copy" dir="auto">{goalProgress}% {t("income_goalLine", { goal: currency(dailyGoal) })}</p>
          </div>
        </section>
      ) : null}

      <WorkAppPicker open={showPicker} onClose={() => setShowPicker(false)} />
    </main>
  );
}

/** Why no Waggle jobs are showing, when the reason is verification. */
function VerifyCard({ status, note, onOpen }: { status: string | null; note: string | null; onOpen: () => void }) {
  const t = useT();
  const title = status === "pending" ? "ver_pendingTitle" : status === "rejected" ? "ver_rejectedTitle" : status === "suspended" ? "ver_suspendedTitle" : "ver_cardTitle";
  const body = status === "pending" ? "ver_pendingBody" : status === "suspended" ? "ver_suspendedBody" : "ver_cardBody";
  return (
    <div className="dashboard-card glass-card income-empty verify-card">
      <span className="income-empty-icon"><ShieldCheck size={28} /></span>
      <strong>{t(title)}</strong>
      {status === "rejected" && note ? <p>{note}</p> : <p>{t(body)}</p>}
      {status === null || status === "rejected" ? (
        <Button onClick={onOpen}>{t(status === "rejected" ? "ver_fix" : "ver_cardButton")}</Button>
      ) : null}
    </div>
  );
}

function Stat({
  icon,
  value,
  label,
  highlight,
}: {
  icon: ReactNode;
  value: string;
  label: string;
  highlight?: boolean;
}) {
  return (
    <div className={`stat-box ${highlight ? "highlight" : ""}`}>
      <span>{icon}</span>
      <strong>{value}</strong>
      <small>{label}</small>
    </div>
  );
}
