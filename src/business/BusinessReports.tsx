import { Download } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "../components/ui/Button";
import { useT, type TKey } from "../i18n";
import { saveFile } from "../utils/saveFile";
import { BusinessTop, rupees } from "./BusinessScreens";
import type { Business, Report } from "./BusinessService";

type Range = "7d" | "30d" | "month" | "last";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function rangeDates(range: Range): [string, string] {
  const today = new Date();
  if (range === "7d") return [iso(new Date(Date.now() - 6 * 864e5)), iso(today)];
  if (range === "30d") return [iso(new Date(Date.now() - 29 * 864e5)), iso(today)];
  if (range === "month") return [iso(new Date(today.getFullYear(), today.getMonth(), 1)), iso(today)];
  return [iso(new Date(today.getFullYear(), today.getMonth() - 1, 1)), iso(new Date(today.getFullYear(), today.getMonth(), 0))];
}

const RANGES: { id: Range; label: TKey }[] = [
  { id: "7d", label: "bx_rep7" },
  { id: "30d", label: "bx_rep30" },
  { id: "month", label: "bx_repMonth" },
  { id: "last", label: "bx_repLast" },
];

export function ReportsScreen({
  business,
  onLoad,
  nav,
}: {
  business: Business;
  onLoad: (from: string, to: string) => Promise<Report>;
  nav?: ReactNode;
}) {
  const t = useT();
  const [range, setRange] = useState<Range>("30d");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    const [from, to] = rangeDates(range);
    setError("");
    onLoad(from, to)
      .then((r) => live && setReport(r))
      .catch((err) => live && setError(err instanceof Error ? err.message : t("biz_errGeneric")));
    return () => { live = false; };
  }, [range]); // eslint-disable-line react-hooks/exhaustive-deps

  function csv() {
    if (!report) return;
    const rows = [["Date", "Deliveries sent", "Delivered", "Orders", "Order sales (Rs)"]];
    for (const d of report.days) rows.push([d.day, String(d.sent), String(d.delivered), String(d.orders), (d.sales_paise / 100).toFixed(2)]);
    rows.push([]);
    rows.push(["Waggle fees on delivered orders (Rs)", (report.deliveries.fees_paise / 100).toFixed(2)]);
    rows.push(["Fares paid to workers (Rs)", String(report.deliveries.fares)]);
    const text = rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n");
    void saveFile(`waggle-report-${report.from}-to-${report.to}.csv`, "text/csv", text);
  }

  const d = report?.deliveries;
  const o = report?.orders;
  const delivered = d?.delivered ?? 0;
  const rate = d && d.sent ? Math.round((delivered / d.sent) * 100) : null;

  return (
    <div className="biz-frame biz-frame-wide">
      <BusinessTop business={business}>
        <div className="biz-top-business"><h1>{t("bx_repTitle")}</h1><p>{t("bx_repSub")}</p></div>
      </BusinessTop>
      {nav}
      <div className="biz-body">
        <div className="biz-rangebar">
          <div className="biz-chips" role="radiogroup" aria-label={t("bx_repTitle")}>
            {RANGES.map((r) => (
              <button key={r.id} type="button" role="radio" aria-checked={range === r.id} className={`biz-chip${range === r.id ? " is-on" : ""}`} onClick={() => setRange(r.id)}>
                {t(r.label)}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" disabled={!report} onClick={csv}><Download size={15} /> CSV</Button>
        </div>
        {error ? <p className="biz-error" role="alert">{error}</p> : null}
        {!report ? <p className="biz-loading">{t("biz_loading")}</p> : (
          <>
            <section className="biz-kpis">
              <Kpi label={t("bx_kpiDelivered")} value={String(delivered)} sub={rate === null ? undefined : t("bx_kpiRate", { rate: String(rate) })} />
              <Kpi label={t("bx_kpiOrders")} value={String(o?.placed ?? 0)} sub={t("bx_kpiOrdersDone", { count: String(o?.delivered ?? 0) })} />
              <Kpi label={t("bx_kpiSales")} value={rupees((o?.sales_paise ?? 0) / 100)} sub={o?.avg_order_paise ? t("bx_kpiAvg", { amount: rupees(o.avg_order_paise / 100) }) : undefined} />
              <Kpi label={t("bx_kpiFees")} value={rupees((d?.fees_paise ?? 0) / 100)} sub={t("bx_kpiFares", { amount: rupees(d?.fares ?? 0) })} />
              <Kpi label={t("bx_kpiAccept")} value={d?.avg_accept_min == null ? "—" : t("bx_minutes", { n: String(d.avg_accept_min) })} />
              <Kpi label={t("bx_kpiRide")} value={d?.avg_ride_min == null ? "—" : t("bx_minutes", { n: String(d.avg_ride_min) })} />
            </section>

            <section className="biz-card">
              <div className="biz-card-head"><strong>{t("bx_repChart")}</strong><span className="biz-muted">{t("bx_repChartKey")}</span></div>
              <DayBars days={report.days} />
            </section>

            <div className="biz-grid-2">
              <section className="biz-card">
                <div className="biz-card-head"><strong>{t("bx_repAreas")}</strong></div>
                {report.areas.length === 0 ? <p className="biz-help">{t("bx_repNone")}</p> : (
                  <ul className="biz-rank">
                    {report.areas.map((a) => (
                      <li key={a.area}><span>{a.area}</span><i style={{ width: `${Math.round((a.count / report.areas[0].count) * 100)}%` }} /><b>{a.count}</b></li>
                    ))}
                  </ul>
                )}
              </section>
              <section className="biz-card">
                <div className="biz-card-head"><strong>{t("bx_repItems")}</strong></div>
                {report.top_items.length === 0 ? <p className="biz-help">{t("bx_repNone")}</p> : (
                  <ul className="biz-rank">
                    {report.top_items.map((i) => (
                      <li key={i.name}><span>{i.name}</span><i style={{ width: `${Math.round((i.qty / report.top_items[0].qty) * 100)}%` }} /><b>{i.qty}</b></li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
            <p className="biz-help">{t("bx_repSources", {
              app: String(d?.by_source.app ?? 0), order: String(d?.by_source.order ?? 0), api: String(d?.by_source.api ?? 0),
            })}</p>
          </>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="biz-kpi">
      <span>{label}</span>
      <b>{value}</b>
      {sub ? <small>{sub}</small> : null}
    </div>
  );
}

/** Deliveries a day as bars, one axis; hover or tap a bar for the day's numbers. */
function DayBars({ days }: { days: Report["days"] }) {
  const t = useT();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.sent));
  const h = 150;
  const w = 100 / days.length;
  const shown = hover === null ? null : days[hover];
  return (
    <div className="biz-bars">
      <svg viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" role="img" aria-label={t("bx_repChart")} onMouseLeave={() => setHover(null)}>
        {[0.5, 1].map((f) => <line key={f} x1="0" x2="100" y1={h - f * (h - 8)} y2={h - f * (h - 8)} className="biz-bars-grid" />)}
        {days.map((d, i) => {
          const sentH = (d.sent / max) * (h - 8);
          const doneH = (d.delivered / max) * (h - 8);
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}>
              <rect x={i * w} y={0} width={w} height={h} fill="transparent" />
              <rect x={i * w + w * 0.18} y={h - sentH} width={w * 0.64} height={sentH} className="biz-bar-sent" rx="0.6" />
              <rect x={i * w + w * 0.18} y={h - doneH} width={w * 0.64} height={doneH} className="biz-bar-done" rx="0.6" />
            </g>
          );
        })}
      </svg>
      <div className="biz-bars-axis"><span>{days[0]?.day.slice(5)}</span><span>{t("bx_repMax", { n: String(max) })}</span><span>{days[days.length - 1]?.day.slice(5)}</span></div>
      <p className="biz-bars-tip" aria-live="polite">
        {shown ? t("bx_repTip", { day: new Date(`${shown.day}T00:00:00`).toLocaleDateString([], { day: "numeric", month: "short" }), sent: String(shown.sent), done: String(shown.delivered), orders: String(shown.orders) }) : t("bx_repTipHint")}
      </p>
    </div>
  );
}
