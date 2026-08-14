import { Clock3, MapPin, Settings, Target, TrendingUp, Wallet } from "lucide-react";
import { WorkAppMark } from "../components/WorkAppMark";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { WorkAppPicker } from "../components/WorkAppPicker";
import { Button } from "../components/ui/Button";
import { APP_NAME } from "../config/constants";
import { useT } from "../i18n";
import { useAuthStore } from "../stores/useAuthStore";
import { useLocationStore } from "../stores/useLocationStore";
import { useConsentStore } from "../stores/useConsentStore";
import { useNavigate } from "react-router-dom";
import { useProfileStore } from "../stores/useProfileStore";
import { currency, currencyPrecise, duration, initials } from "../utils/format";
import { getWorkApp } from "../utils/workApps";

export function HomeScreen() {
  const navigate = useNavigate();
  const t = useT();
  const user = useAuthStore((state) => state.user);
  const [showPicker, setShowPicker] = useState(false);
  const consented = useConsentStore((state) => state.accepted);
  const [showSplash, setShowSplash] = useState(() => sessionStorage.getItem("masaya_splash") !== "shown");
  const activeApp = useProfileStore((state) => state.activeApp);
  const baseRate = useProfileStore((state) => state.baseRate);
  const dailyGoal = useProfileStore((state) => state.dailyGoal);
  const homeAddress = useProfileStore((state) => state.homeAddress);
  // Subscribe to the currency so all money on this screen re-renders when it changes.
  const currencyCode = useProfileStore((state) => state.currencyCode);
  const totalDistanceKm = useLocationStore((state) => state.totalDistanceKm);
  const elapsedMinutes = useLocationStore((state) => state.elapsedMinutes);
  const isTracking = useLocationStore((state) => state.isTracking);
  const startTracking = useLocationStore((state) => state.startTracking);
  const stopTracking = useLocationStore((state) => state.stopTracking);
  const app = getWorkApp(activeApp);
  const earnings = totalDistanceKm * baseRate;
  const goalProgress = Math.min(100, Math.round((earnings / dailyGoal) * 100));
  // The income dashboard is only visible while a delivery session is actively running.
  // The moment tracking stops, it returns to the "starts when you deliver" state.
  const deliveringStarted = isTracking;
  const perHour = elapsedMinutes >= 1 ? earnings / (elapsedMinutes / 60) : 0;
  const hour = new Date().getHours();
  const greetKey = hour < 12 ? "greet_morning" : hour < 18 ? "greet_afternoon" : "greet_evening";

  // Wait for consent before prompting for a working app. Both fired on a first
  // launch, so two modals opened at the same z-index and the driver had to
  // dismiss both — in whichever order they happened to stack — before anything
  // responded. Consent is a gate; nothing else opens in front of it.
  useEffect(() => {
    if (!activeApp && consented) setShowPicker(true);
  }, [activeApp, consented]);

  useEffect(() => {
    if (!showSplash) return;
    const timer = window.setTimeout(() => {
      sessionStorage.setItem("masaya_splash", "shown");
      setShowSplash(false);
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [showSplash]);

  return (
    <main className="page-shell" data-currency={currencyCode}>
      {showSplash ? (
        <div className="splash-screen">
          <div className="splash-avatar">{initials(user?.fullName ?? APP_NAME)}</div>
          <h1>{APP_NAME}</h1>
          <p>{t("auth_tagline")}</p>
          <div className="splash-dots"><span /><span /><span /></div>
        </div>
      ) : null}

      <section className="home-hero">
        <div className="home-hero-text">
          <p>{t(greetKey)}</p>
          <h2>{t("home_hello")}, {user?.fullName ?? "Driver"}</h2>
        </div>
        <div className="home-hero-avatar">{initials(user?.fullName ?? "Driver")}</div>
      </section>

      <button className="working-app-card glass-card" onClick={() => setShowPicker(true)}>
        <span>{t("home_workingApp")}</span>
        {app ? (
          <strong><WorkAppMark app={app} size={22} /> {app.name} <small>{t("common_change")}</small></strong>
        ) : (
          <strong>{t("home_selectApp")} →</strong>
        )}
      </button>

      <section className="dashboard-card glass-card journey-card">
        <div className="section-heading">
          <div>
            <h3><MapPin size={19} /> {t("home_journey")}</h3>
            <p>{homeAddress || t("home_setAddress")}</p>
          </div>
          {/* This button rendered and did nothing — no handler at all. Profile
              already opens its settings sheet from ?settings=true, so reuse that
              rather than inventing a second way in. */}
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
        <p className="micro-copy">{t("home_rateLine", { rate: currencyPrecise(baseRate) })}</p>
        <div className="tracking-actions">
          <Button onClick={isTracking ? stopTracking : startTracking}>
            {isTracking ? t("home_stopTracking") : t("home_startTracking")}
          </Button>
        </div>
      </section>

      <section className="dashboard-card glass-card goal-card">
        <GoalRing pct={goalProgress} />
        <div className="goal-info">
          <h3><Target size={19} /> {t("home_dailyGoal")}</h3>
          <strong>{currencyPrecise(earnings)}</strong>
          <p>{t("home_of")} {currency(dailyGoal)} {t("home_target")}</p>
          <small className="micro-copy">{duration(elapsedMinutes)} {t("home_trackedToday")}</small>
        </div>
      </section>

      {deliveringStarted ? (
        <section className="dashboard-card glass-card income-card">
          <div className="section-heading">
            <div>
              <h3><TrendingUp size={19} /> {t("income_title")}</h3>
              <p>{t("income_live")}</p>
            </div>
            <span className="live-pill">● LIVE</span>
          </div>
          <div className="income-amount">{currencyPrecise(earnings)}</div>
          <div className="income-metrics">
            <div className="income-metric">
              <span><Clock3 size={18} /></span>
              {/* An hourly rate needs at least a minute of elapsed time. Show a
                  dash rather than "0", which reads as broken in the first 60s. */}
              <strong>{elapsedMinutes >= 1 ? currencyPrecise(perHour) : "—"}</strong>
              <small>{t("income_perHour")}</small>
            </div>
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
          </div>
          <div className="income-goal">
            <div className="progress-track"><span style={{ width: `${goalProgress}%` }} /></div>
            <p className="micro-copy">{goalProgress}% {t("income_goalLine", { goal: currency(dailyGoal) })}</p>
          </div>
        </section>
      ) : (
        <section className="dashboard-card glass-card income-empty">
          <span className="income-empty-icon"><Wallet size={28} /></span>
          <strong>{t("income_emptyTitle")}</strong>
          <p>{t("income_emptyBody")}</p>
        </section>
      )}

      <WorkAppPicker open={showPicker} onClose={() => setShowPicker(false)} />
    </main>
  );
}

function GoalRing({ pct }: { pct: number }) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(100, pct) / 100) * circumference;
  return (
    <svg className="goal-ring" width="90" height="90" viewBox="0 0 90 90" aria-hidden>
      <defs>
        <linearGradient id="goalGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ff5a1f" />
          <stop offset="100%" stopColor="#ff9d3d" />
        </linearGradient>
      </defs>
      <circle cx="45" cy="45" r={radius} fill="none" stroke="var(--muted)" strokeWidth="8" />
      <circle
        cx="45"
        cy="45"
        r={radius}
        fill="none"
        stroke="url(#goalGrad)"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform="rotate(-90 45 45)"
        className="goal-ring-fg"
      />
      <text x="45" y="50" textAnchor="middle" className="goal-ring-text">{Math.min(100, pct)}%</text>
    </svg>
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
