import { CheckCircle2, Clock3, Gauge, HandCoins, Info, Route, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useBrandBand } from "../hooks/useBrandBand";
import { useLangStore, useT } from "../i18n";
import { useJobStore } from "../stores/useJobStore";
import type { Job } from "../types";
import { currency } from "../utils/format";
import { GigService, istDay, type Earnings } from "./GigService";
import { dayLabel, hoursMinutes } from "./gigFormat";

type Period = "today" | "week" | "month";

/** The first day of the period, in India time. Weeks start on Monday. */
function periodStart(p: Period): string {
  const today = istDay();
  if (p === "today") return today;
  const [y, m, d] = today.split("-").map(Number);
  if (p === "month") return `${y}-${String(m).padStart(2, "0")}-01`;
  const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return istDay(-weekday);
}

/**
 * What the rider actually earned: the fares of delivered Waggle jobs, straight
 * from the database. Every rupee of the fare is the rider's; Waggle charges the
 * shop, not the rider. Hours are the time they were online.
 */
export function GigEarnings() {
  const t = useT();
  useBrandBand("home");
  const lang = useLangStore((s) => s.lang);
  const [period, setPeriod] = useState<Period>("week");
  const [data, setData] = useState<Earnings | null>(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const jobs = useJobStore((s) => s.jobs);
  const reportUnpaid = useJobStore((s) => s.reportUnpaid);
  const doneCount = jobs.filter((j) => j.status === "completed").length;

  useEffect(() => {
    let live = true;
    setError("");
    setPicked(null);
    GigService.earnings(periodStart(period), istDay())
      .then((e) => live && setData(e))
      .catch((err) => live && setError(err instanceof Error ? err.message : t("job_stepError")));
    return () => { live = false; };
  }, [period, doneCount]); // eslint-disable-line react-hooks/exhaustive-deps

  const perHour = data && data.onlineMinutes >= 15 ? data.fare / (data.onlineMinutes / 60) : null;
  const perDelivery = data && data.deliveries ? data.fare / data.deliveries : null;
  const twoWeeks = Date.now() - 14 * 864e5;
  const shopPay = jobs.filter((j) => j.status === "completed" && j.businessId && (j.deliveredAt ?? 0) >= twoWeeks);

  return (
    <main className="page-shell gg-page">
      <section className="home-band gg-band gg-earn-band">
        <div className="gg-seg" role="tablist">
          {(["today", "week", "month"] as Period[]).map((p) => (
            <button key={p} role="tab" aria-selected={period === p} className={period === p ? "is-on" : ""} onClick={() => setPeriod(p)}>
              {t(`gg_p_${p}` as "gg_p_today")}
            </button>
          ))}
        </div>
        <p className="gg-earn-label">{t("gg_earnedLabel")}</p>
        <strong className="gg-earn-total">{data ? currency(data.fare) : "—"}</strong>
        <p className="gg-earn-sub">
          {data ? t("gg_earnSub", { n: String(data.deliveries), km: String(data.km), time: hoursMinutes(data.onlineMinutes) }) : error || t("history_loading")}
        </p>
      </section>

      <section className="gg-stats">
        <Stat icon={<Gauge size={18} />} value={perHour != null ? currency(Math.round(perHour)) : "—"} label={t("gg_perHour")} />
        <Stat icon={<HandCoins size={18} />} value={perDelivery != null ? currency(Math.round(perDelivery)) : "—"} label={t("gg_perDelivery")} />
        <Stat icon={<Route size={18} />} value={data ? `${data.km} km` : "—"} label={t("gg_kmDelivered")} />
        <Stat icon={<Clock3 size={18} />} value={data ? hoursMinutes(data.onlineMinutes) : "—"} label={t("gg_timeOnline")} />
      </section>

      {data && period !== "today" ? (
        <section className="dashboard-card glass-card">
          <div className="gg-card-head"><h3>{t("gg_byDay")}</h3></div>
          <DayBars days={data.days} picked={picked} onPick={setPicked} lang={lang} />
          <table className="gg-daytable">
            <thead><tr><th>{t("gg_day")}</th><th>{t("gg_todayDeliveries")}</th><th>{t("gg_timeOnline")}</th><th>{t("gg_earned")}</th></tr></thead>
            <tbody>
              {[...data.days].reverse().filter((d) => d.deliveries || d.onlineMinutes).map((d) => (
                <tr key={d.day} className={picked === d.day ? "is-on" : ""}>
                  <td>{dayLabel(d.day, t("gg_today"), t("gg_yesterday"), lang)}</td>
                  <td>{d.deliveries}</td>
                  <td>{hoursMinutes(d.onlineMinutes)}</td>
                  <td><b>{currency(d.fare)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.days.some((d) => d.deliveries || d.onlineMinutes) ? <p className="micro-copy">{t("gg_noWorkYet")}</p> : null}
        </section>
      ) : null}

      {data ? (
        <section className="dashboard-card glass-card gg-shoppay-sum">
          <div className="gg-card-head"><h3><Wallet size={18} /> {t("job_payTitle")}</h3></div>
          <div className="gg-paygrid">
            <div className="is-paid"><b>{currency(data.shopPaid)}</b><small>{t("gg_paidIn")}</small></div>
            <div><b>{currency(data.shopWaiting)}</b><small>{t("gg_waiting")}</small></div>
            <div className={data.shopDisputed ? "is-disputed" : ""}><b>{currency(data.shopDisputed)}</b><small>{t("gg_notReceived")}</small></div>
          </div>
          <p className="micro-copy">{t("job_payHelp")}</p>
          {shopPay.length ? <ShopPayList jobs={shopPay} onReport={reportUnpaid} /> : null}
        </section>
      ) : null}

      <p className="gg-note"><Info size={15} /> {t("gg_fairNote")}</p>
    </main>
  );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="gg-stat">
      <span>{icon}</span>
      <b>{value}</b>
      <small>{label}</small>
    </div>
  );
}

/** One bar a day, one colour. Tap a bar for that day's figures. */
function DayBars({ days, picked, onPick, lang }: { days: Earnings["days"]; picked: string | null; onPick: (d: string | null) => void; lang: string }) {
  const t = useT();
  const max = useMemo(() => Math.max(1, ...days.map((d) => d.fare)), [days]);
  const W = 320, H = 132, gap = days.length > 14 ? 2 : 6;
  const bw = (W - gap * (days.length - 1)) / days.length;
  const sel = days.find((d) => d.day === picked) ?? null;
  const best = days.reduce((a, d) => (d.fare > (a?.fare ?? 0) ? d : a), null as Earnings["days"][number] | null);
  const shown = sel ?? best;
  return (
    <div className="gg-bars">
      <p className="gg-bars-read" aria-live="polite">
        {shown && shown.fare > 0
          ? t(sel ? "gg_barDay" : "gg_barBest", { day: dayLabel(shown.day, t("gg_today"), t("gg_yesterday"), lang), amount: currency(shown.fare), n: String(shown.deliveries) })
          : t("gg_barEmpty")}
      </p>
      <svg viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label={t("gg_byDay")}>
        <line x1="0" x2={W} y1={H} y2={H} className="gg-bars-base" />
        {days.map((d, i) => {
          const h = d.fare > 0 ? Math.max(4, (d.fare / max) * (H - 8)) : 0;
          const x = i * (bw + gap);
          const [y, m, dd] = d.day.split("-").map(Number);
          const wk = new Date(y, m - 1, dd);
          return (
            <g key={d.day} onClick={() => onPick(picked === d.day ? null : d.day)} className={`gg-bar${picked === d.day ? " is-on" : ""}`}>
              <rect x={x} y={0} width={bw} height={H} fill="transparent" />
              {h ? <path d={`M${x},${H} v${-(h - 4)} q0,-4 4,-4 h${bw - 8} q4,0 4,4 v${h - 4} z`} /> : null}
              {days.length <= 7 || i % 5 === 0 || i === days.length - 1 ? (
                <text x={x + bw / 2} y={H + 14} textAnchor="middle">
                  {days.length <= 7 ? new Intl.DateTimeFormat(lang, { weekday: "narrow" }).format(wk) : dd}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Each shop job of the last two weeks: paid, waiting, or reported. */
export function ShopPayList({ jobs, onReport }: { jobs: Job[]; onReport: (id: string) => Promise<unknown> }) {
  const t = useT();
  return (
    <ul className="gg-paylist">
      {jobs.map((job) => (
        <li key={job.id} className={job.riderPayDisputedAt ? "is-disputed" : job.riderPaidAt ? "is-paid" : ""}>
          <div>
            <strong>{job.dropoff}</strong>
            <small>
              {job.riderPayDisputedAt ? t("job_payDisputed") : job.riderPaidAt ? t("job_payPaid", { utr: job.riderPayUtr ?? "" }) : t("job_payWaiting")}
            </small>
          </div>
          <b>{job.riderPaidAt && !job.riderPayDisputedAt ? <CheckCircle2 size={15} /> : null} {currency(job.payout)}</b>
          {job.riderPaidAt && !job.riderPayDisputedAt ? (
            <button type="button" className="gg-report" onClick={() => { if (window.confirm(t("job_payConfirm"))) void onReport(job.id); }}>
              {t("job_payNotReceived")}
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
