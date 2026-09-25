import { ArrowLeft, Search, Store } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useT, type TKey } from "../i18n";
import { DietMark } from "../business/BusinessCatalog";
import { rupees, WgFrame } from "./common";
import { useWaggleLocation } from "./useWaggleLocation";
import { WaggleService, type SearchItem } from "./WaggleService";

const HINTS = ["dosa", "biryani", "milk", "cake", "charger", "medicine"];

/** One box for every nearby shop: dishes, products and shops, nearest and cheapest first. */
export function SearchPage() {
  const t = useT();
  const navigate = useNavigate();
  const place = useWaggleLocation((s) => s.place);
  const [q, setQ] = useState("");
  const [result, setResult] = useState<{ shops: { id: string; name: string; kind: string; open: boolean; km: number }[]; items: SearchItem[] } | null>(null);

  useEffect(() => {
    if (!place || q.trim().length < 2) { setResult(null); return; }
    let live = true;
    // Wait for a pause in typing before asking.
    const timer = window.setTimeout(() => {
      void WaggleService.search(place.lat, place.lng, q).then((r) => live && setResult(r)).catch(() => live && setResult({ shops: [], items: [] }));
    }, 250);
    return () => { live = false; window.clearTimeout(timer); };
  }, [q, place?.lat, place?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // The same product at more than one shop: say which is cheapest.
  const cheapest = new Map<string, number>();
  for (const i of result?.items ?? []) {
    const key = i.name.toLowerCase();
    cheapest.set(key, Math.min(cheapest.get(key) ?? Infinity, i.priceRupees));
  }
  const repeated = (name: string) => (result?.items ?? []).filter((i) => i.name.toLowerCase() === name.toLowerCase()).length > 1;

  return (
    <WgFrame nav bar={<button type="button" className="wg-back" onClick={() => navigate(-1)}><ArrowLeft size={18} /></button>}>
      <main className="wg-page">
        <label className="wg-search wg-search-big">
          <Search size={18} />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("wg_searchAllPh")} maxLength={60} />
        </label>
        {!place ? <p className="wg-fine">{t("wg_searchNeedsPlace")}</p> : null}
        {!q ? (
          <div className="wg-hints">
            <span>{t("wg_try")}</span>
            {HINTS.map((h) => <button key={h} type="button" onClick={() => setQ(h)}>{h}</button>)}
          </div>
        ) : null}
        {result && !result.items.length && !result.shops.length ? (
          <section className="wg-card wg-empty"><Search size={26} /><p>{t("wg_noMatch", { q })}</p></section>
        ) : null}
        {result?.shops.length ? (
          <section className="wg-card wg-results">
            <h2 className="wg-h2">{t("wg_shopsTitle")}</h2>
            {result.shops.map((s) => (
              <Link key={s.id} to={`/shop/${s.id}`} className="wg-result-shop">
                <Store size={18} />
                <span><strong>{s.name}</strong><small>{t(`bx_kind_${s.kind}` as TKey)} · {t("wg_km", { km: String(s.km) })}{s.open ? "" : ` · ${t("wg_closed")}`}</small></span>
              </Link>
            ))}
          </section>
        ) : null}
        {result?.items.length ? (
          <section className="wg-card wg-results">
            <h2 className="wg-h2">{t("wg_itemsTitle")}</h2>
            {result.items.map((i) => (
              <Link key={i.id} to={`/shop/${i.shopId}`} className={`wg-result-item${i.soldOut ? " is-soldout" : ""}`}>
                {i.photoUrl ? <img src={i.photoUrl} alt="" loading="lazy" /> : <span className="wg-result-ph">{i.name.slice(0, 1)}</span>}
                <span>
                  <strong><DietMark diet={i.diet} /> {i.name}</strong>
                  <small>{[i.quantityLabel, i.brand].filter(Boolean).join(" · ")}</small>
                  <small>{i.shop} · {t("wg_km", { km: String(i.km) })}{i.open ? "" : ` · ${t("wg_closed")}`}</small>
                </span>
                <b>
                  {rupees(i.priceRupees)}
                  {repeated(i.name) && cheapest.get(i.name.toLowerCase()) === i.priceRupees ? <em className="wg-cheapest">{t("wg_cheapest")}</em> : null}
                  {i.soldOut ? <em className="wg-soldout-tag">{t("wg_soldOut")}</em> : null}
                </b>
              </Link>
            ))}
          </section>
        ) : null}
      </main>
    </WgFrame>
  );
}
