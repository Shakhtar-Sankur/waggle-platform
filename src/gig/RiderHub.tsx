import { AlertTriangle, Ambulance, CircleHelp, Megaphone, MessageSquareReply, ShieldAlert, Siren } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { useLocationStore } from "../stores/useLocationStore";
import { GigService, type Notice, type Ticket } from "./GigService";
import { HelpSheet } from "./HelpSheet";

const when = (iso: string) => new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/**
 * The rider hub, first tab of Community: what Gigzen is telling riders (zone
 * alerts where the rider is, news, safety), help with an answer that comes
 * back, and emergency numbers one tap away.
 */
export function RiderHub() {
  const t = useT();
  const here = useLocationStore((s) => s.currentLocation);
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");

  const loadTickets = () => GigService.tickets().then(setTickets).catch(() => undefined);

  useEffect(() => {
    let live = true;
    GigService.hub(here.fallback ? undefined : here.lat, here.fallback ? undefined : here.lng)
      .then((n) => live && setNotices(n))
      .catch((err) => { if (live) { setNotices([]); setError(err instanceof Error ? err.message : ""); } });
    void loadTickets();
    return () => { live = false; };
  }, [here.fallback]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="fb-body gg-hub">
      <section className="fb-card gg-hub-card">
        <div className="gg-card-head"><h3><Megaphone size={18} /> {t("gg_hubNotices")}</h3></div>
        {notices === null ? <p className="micro-copy">{t("history_loading")}</p> : null}
        {notices && notices.length === 0 ? <p className="micro-copy">{error || t("gg_hubNone")}</p> : null}
        {(notices ?? []).map((n) => (
          <article key={n.id} className={`gg-notice gg-notice-${n.kind}`}>
            <span className="gg-notice-icon">{n.kind === "zone_alert" ? <AlertTriangle size={18} /> : n.kind === "safety" ? <ShieldAlert size={18} /> : <Megaphone size={18} />}</span>
            <div>
              <small>
                {t(`gg_kind_${n.kind}` as "gg_kind_news")}
                {n.area ? ` · ${n.area}` : ""}
                {n.kmAway != null ? ` · ${t("gg_away", { km: String(n.kmAway) })}` : ""}
                {" · "}{when(n.startsAt)}
              </small>
              <strong>{n.title}</strong>
              <p>{n.body}</p>
              {n.endsAt ? <small className="gg-until">{t("gg_until", { time: when(n.endsAt) })}</small> : null}
            </div>
          </article>
        ))}
      </section>

      <section className="fb-card gg-hub-card">
        <div className="gg-card-head">
          <h3><CircleHelp size={18} /> {t("gg_hubHelp")}</h3>
          <button type="button" className="gg-link" onClick={() => setAsking(true)}>{t("gg_ask")}</button>
        </div>
        <p className="micro-copy">{t("gg_hubHelpSub")}</p>
        {tickets.length ? (
          <ul className="gg-tickets">
            {tickets.map((k) => (
              <li key={k.id} className={`is-${k.status}`}>
                <small>{t(`gg_topic_${k.topic}` as "gg_topic_payment")} · {when(k.createdAt)} · {t(`gg_tk_${k.status}` as "gg_tk_open")}</small>
                <p>{k.message}</p>
                {k.reply ? <blockquote><MessageSquareReply size={14} /> {k.reply}</blockquote> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="fb-card gg-hub-card gg-safety">
        <div className="gg-card-head"><h3><ShieldAlert size={18} /> {t("gg_hubSafety")}</h3></div>
        <div className="gg-sosrow">
          <a href="tel:112" className="gg-sosbtn"><Siren size={18} /> <span><b>112</b><small>{t("gg_sos112")}</small></span></a>
          <a href="tel:108" className="gg-sosbtn is-amb"><Ambulance size={18} /> <span><b>108</b><small>{t("gg_sos108")}</small></span></a>
        </div>
        <ul className="gg-tips-list">
          <li>{t("gg_safe1")}</li>
          <li>{t("gg_safe2")}</li>
          <li>{t("gg_safe3")}</li>
        </ul>
      </section>

      <HelpSheet open={asking} onClose={() => setAsking(false)} topic="other" onSent={() => void loadTickets()} />
    </div>
  );
}
