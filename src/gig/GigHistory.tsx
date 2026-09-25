import { CheckCircle2, ChevronDown, CircleHelp, Clock3, History, MapPin, Phone, Store } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLangStore, useT } from "../i18n";
import { useJobStore } from "../stores/useJobStore";
import { currency } from "../utils/format";
import { GigService, type Delivery } from "./GigService";
import { dayLabel, minutesBetween } from "./gigFormat";
import { HelpSheet } from "./HelpSheet";

const PAGE = 30;

const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—");
const istDate = (iso: string) => new Date(new Date(iso).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);

/** Every delivery the rider made, newest first, grouped by day. */
export function GigHistory() {
  const t = useT();
  const lang = useLangStore((s) => s.lang);
  const doneCount = useJobStore((s) => s.jobs.filter((j) => j.status === "completed").length);
  const [items, setItems] = useState<Delivery[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [help, setHelp] = useState<Delivery | null>(null);

  useEffect(() => {
    let live = true;
    GigService.history(undefined, PAGE)
      .then((rows) => { if (live) { setItems(rows); setMore(rows.length === PAGE); } })
      .catch((err) => live && setError(err instanceof Error ? err.message : t("job_stepError")));
    return () => { live = false; };
  }, [doneCount]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadMore() {
    const last = items?.[items.length - 1];
    if (!last) return;
    const rows = await GigService.history(last.deliveredAt, PAGE);
    setItems((cur) => [...(cur ?? []), ...rows]);
    setMore(rows.length === PAGE);
  }

  const groups = useMemo(() => {
    const out: { day: string; rows: Delivery[]; total: number }[] = [];
    for (const d of items ?? []) {
      const day = istDate(d.deliveredAt);
      const g = out[out.length - 1];
      if (g && g.day === day) { g.rows.push(d); g.total += d.fare; } else out.push({ day, rows: [d], total: d.fare });
    }
    return out;
  }, [items]);

  return (
    <main className="page-shell gg-page">
      <header className="gg-pagehead">
        <h2><History size={22} /> {t("gg_historyTitle")}</h2>
        <p>{t("gg_historySub")}</p>
      </header>

      {error ? <p className="job-message" role="alert">{error}</p> : null}
      {items === null && !error ? <p className="micro-copy">{t("history_loading")}</p> : null}
      {items && items.length === 0 ? (
        <section className="dashboard-card glass-card income-empty">
          <span className="income-empty-icon"><History size={28} /></span>
          <strong>{t("gg_historyEmpty")}</strong>
          <p>{t("gg_historyEmptySub")}</p>
        </section>
      ) : null}

      {groups.map((g) => (
        <section key={g.day} className="gg-day">
          <h3 className="jobs-group-title">
            <span>{dayLabel(g.day, t("gg_today"), t("gg_yesterday"), lang)}</span>
            <span>{t("gg_dayTotal", { n: String(g.rows.length), amount: currency(g.total) })}</span>
          </h3>
          {g.rows.map((d) => {
            const isOpen = open === d.id;
            const toShop = minutesBetween(d.acceptedAt, d.pickedUpAt);
            const toDoor = minutesBetween(d.pickedUpAt, d.deliveredAt);
            return (
              <article key={d.id} className={`gg-trip${isOpen ? " is-open" : ""}`}>
                <button type="button" className="gg-trip-row" onClick={() => setOpen(isOpen ? null : d.id)} aria-expanded={isOpen}>
                  <span className="gg-trip-main">
                    <strong>{d.shopName ?? d.pickup.split(",")[0]}</strong>
                    <small><MapPin size={12} /> {d.dropoff} · {d.km} km · {clock(d.deliveredAt)}</small>
                  </span>
                  <span className="gg-trip-fare">
                    <b>{currency(d.fare)}</b>
                    {d.shopName ? (
                      <em className={d.disputedAt ? "is-disputed" : d.paidAt ? "is-paid" : ""}>
                        {t(d.disputedAt ? "gg_notReceived" : d.paidAt ? "gg_paid" : "gg_waiting")}
                      </em>
                    ) : null}
                  </span>
                  <ChevronDown size={16} className="gg-chev" />
                </button>
                {isOpen ? (
                  <div className="gg-trip-more">
                    <ol className="gg-timeline">
                      <li><Clock3 size={13} /> {t("gg_tAccepted", { time: clock(d.acceptedAt) })}</li>
                      <li><Store size={13} /> {t("gg_tPicked", { time: clock(d.pickedUpAt) })}{toShop != null ? ` · ${t("gg_tMin", { n: String(toShop) })}` : ""}</li>
                      <li><CheckCircle2 size={13} /> {t("gg_tDelivered", { time: clock(d.deliveredAt) })}{toDoor != null ? ` · ${t("gg_tMin", { n: String(toDoor) })}` : ""}</li>
                    </ol>
                    <dl className="gg-facts">
                      <div><dt>{t("job_pickupFrom")}</dt><dd>{d.pickup}</dd></div>
                      {d.reference ? <div><dt>{t("gg_ref")}</dt><dd>{d.source === "order" ? t("bx_srcOrder", { code: d.reference }) : d.reference}</dd></div> : null}
                      {d.utr ? <div><dt>UTR</dt><dd>{d.utr}</dd></div> : null}
                    </dl>
                    <div className="gg-contact">
                      {d.shopPhone ? <a href={`tel:${d.shopPhone.replace(/\s/g, "")}`}><Phone size={15} /> {t("gg_callShop")}</a> : null}
                      <button type="button" onClick={() => setHelp(d)}><CircleHelp size={15} /> {t("gg_getHelp")}</button>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>
      ))}

      {more ? <button type="button" className="gg-more" onClick={() => void loadMore()}>{t("gg_loadMore")}</button> : null}

      <HelpSheet
        open={help !== null}
        onClose={() => setHelp(null)}
        jobId={help?.id}
        jobLabel={help ? `${help.shopName ?? help.pickup.split(",")[0]} → ${help.dropoff}` : undefined}
        topic={help?.shopName && (!help.paidAt || help.disputedAt) ? "payment" : "delivery"}
      />
    </main>
  );
}
