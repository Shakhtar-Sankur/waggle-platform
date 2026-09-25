import { Bike, ChevronDown, Clock3, MapPin, Package, Search, ShoppingBag, SlidersHorizontal, Star, Truck, UtensilsCrossed } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useT, type TKey } from "../i18n";
import { DietMark } from "../business/BusinessCatalog";
import { rupees, WgFrame } from "./common";
import { LocationSheet } from "./LocationSheet";
import { useWaggleLocation } from "./useWaggleLocation";
import { WaggleService, type NearbyShop, type Segment } from "./WaggleService";

type Tab = Segment | "send" | "drive";
type Filter = "open" | "rated" | "free" | "veg" | "fast";
type Sort = "near" | "rating";

const TABS: { id: Tab; label: TKey; icon: ReactNode }[] = [
  { id: "food", label: "wg_tabFood", icon: <UtensilsCrossed size={20} /> },
  { id: "shop", label: "wg_tabShop", icon: <ShoppingBag size={20} /> },
  { id: "send", label: "wg_tabSend", icon: <Package size={20} /> },
  { id: "drive", label: "wg_tabDrive", icon: <Bike size={20} /> },
];

/** Where the customer starts: what delivers to them, in Food and Shop. */
export function HomePage() {
  const t = useT();
  const navigate = useNavigate();
  const place = useWaggleLocation((s) => s.place);
  const [picking, setPicking] = useState(false);
  const [tab, setTab] = useState<Tab>("food");
  const [shops, setShops] = useState<NearbyShop[] | null>(null);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<Filter[]>([]);
  const [kind, setKind] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("near");

  useEffect(() => {
    if (!place || (tab !== "food" && tab !== "shop")) return;
    let live = true;
    setShops(null);
    setError("");
    setKind(null);
    WaggleService.nearby(place.lat, place.lng, tab)
      .then((s) => live && setShops(s))
      .catch((e) => live && setError(e instanceof Error ? e.message : t("biz_errGeneric")));
    return () => { live = false; };
  }, [place?.lat, place?.lng, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const kinds = useMemo(() => [...new Set((shops ?? []).map((s) => s.kind))], [shops]);
  const shown = useMemo(() => {
    let list = (shops ?? []).filter((s) =>
      (!filters.includes("open") || s.open)
      && (!filters.includes("rated") || (s.rating ?? 0) >= 4)
      && (!filters.includes("free") || s.deliveryRupees === 0)
      && (!filters.includes("veg") || s.pureVeg)
      && (!filters.includes("fast") || (s.prepMinutes != null && s.prepMinutes <= 20))
      && (!kind || s.kind === kind));
    if (sort === "rating") list = [...list].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || a.km - b.km);
    return list;
  }, [shops, filters, kind, sort]);
  const toggle = (f: Filter) => setFilters((list) => (list.includes(f) ? list.filter((x) => x !== f) : [...list, f]));

  return (
    <WgFrame nav bar={<button type="button" className="wg-locchip" onClick={() => setPicking(true)}>
      <MapPin size={16} />
      <span><small>{t("wg_deliverToShort")}</small><b>{place ? place.area : t("wg_setLocation")}</b></span>
      <ChevronDown size={16} />
    </button>}>
      <main className="wg-page wg-home">
        <button type="button" className="wg-searchbar" onClick={() => navigate("/search")}>
          <Search size={17} /> {t(tab === "shop" ? "wg_searchShopPh" : "wg_searchFoodPh")}
        </button>

        <nav className="wg-tabs" aria-label={t("wg_sections")}>
          {TABS.map((x) => (
            <button key={x.id} type="button" className={tab === x.id ? "is-on" : ""} aria-pressed={tab === x.id} onClick={() => setTab(x.id)}>
              <span className="wg-tab-icon">{x.icon}</span>
              {t(x.label)}
            </button>
          ))}
        </nav>

        {tab === "send" || tab === "drive" ? (
          <section className="wg-card wg-soon">
            <span className="wg-soon-icon">{tab === "send" ? <Truck size={28} /> : <Bike size={28} />}</span>
            <h2>{t(tab === "send" ? "wg_sendTitle" : "wg_driveTitle")}</h2>
            <p>{t(tab === "send" ? "wg_sendSoon" : "wg_driveSoon")}</p>
          </section>
        ) : !place ? (
          <section className="wg-card wg-empty">
            <MapPin size={28} />
            <h2>{t("wg_whereTitle")}</h2>
            <p>{t("wg_whereSub")}</p>
            <button type="button" className="wg-btn wg-btn-primary" onClick={() => setPicking(true)}>{t("wg_setLocation")}</button>
          </section>
        ) : (
          <>
            <div className="wg-filters">
              <button type="button" className={`wg-sort${sort === "rating" ? " is-on" : ""}`} onClick={() => setSort(sort === "near" ? "rating" : "near")}>
                <SlidersHorizontal size={14} /> {t(sort === "near" ? "wg_sortNear" : "wg_sortRating")}
              </button>
              {(["open", "rated", "free", ...(tab === "food" ? ["veg", "fast"] : [])] as Filter[]).map((f) => (
                <button key={f} type="button" className={filters.includes(f) ? "is-on" : ""} aria-pressed={filters.includes(f)} onClick={() => toggle(f)}>
                  {f === "veg" ? <DietMark diet="veg" /> : null}
                  {t(`wg_f_${f}` as TKey)}
                </button>
              ))}
            </div>
            {kinds.length > 1 ? (
              <div className="wg-kinds">
                {kinds.map((k) => (
                  <button key={k} type="button" className={kind === k ? "is-on" : ""} onClick={() => setKind(kind === k ? null : k)}>{t(`bx_kind_${k}` as TKey)}</button>
                ))}
              </div>
            ) : null}

            {error ? <p className="wg-error">{error}</p> : null}
            {shops === null && !error ? <p className="wg-loading">{t("biz_loading")}</p> : null}
            {shops !== null && shown.length === 0 ? (
              <section className="wg-card wg-empty">
                <ShoppingBag size={28} />
                <h2>{t(shops.length ? "wg_noFilterMatch" : tab === "food" ? "wg_noFood" : "wg_noShops")}</h2>
                <p>{t(shops.length ? "wg_noFilterMatchSub" : "wg_noneSub")}</p>
              </section>
            ) : null}
            {shown.length ? <h2 className="wg-section-title">{shown.length === 1 ? t(tab === "food" ? "wg_foodNearOne" : "wg_shopsNearOne") : t(tab === "food" ? "wg_foodNear" : "wg_shopsNear", { n: String(shown.length) })}</h2> : null}
            <div className="wg-shopcards">
              {shown.map((s) => <ShopCard key={s.id} shop={s} />)}
            </div>
          </>
        )}
      </main>
      {picking ? <LocationSheet onClose={() => setPicking(false)} /> : null}
    </WgFrame>
  );
}

function ShopCard({ shop }: { shop: NearbyShop }) {
  const t = useT();
  return (
    <Link to={`/shop/${shop.id}`} className={`wg-shopcard${shop.open ? "" : " is-closed"}`}>
      <div className="wg-shopcard-cover">
        {shop.coverUrl ? <img src={shop.coverUrl} alt="" loading="lazy" /> : <span>{shop.name.slice(0, 1)}</span>}
        {!shop.open ? <em>{t("wg_closed")}</em> : null}
        {shop.pureVeg ? <i className="wg-pureveg"><DietMark diet="veg" /> {t("wg_pureVeg")}</i> : null}
      </div>
      <div className="wg-shopcard-body">
        <div className="wg-shopcard-top">
          <strong>{shop.name}</strong>
          {shop.ratings ? <span className="wg-rating"><Star size={12} fill="currentColor" /> {shop.rating?.toFixed(1)}</span> : <span className="wg-new">{t("wg_new")}</span>}
        </div>
        <span>{t(`bx_kind_${shop.kind}` as TKey)} · {t("wg_km", { km: String(shop.km) })}{shop.fromRupees != null ? ` · ${t("wg_from", { price: rupees(shop.fromRupees) })}` : ""}</span>
        <span className="wg-shopcard-meta">
          {shop.prepMinutes ? <><Clock3 size={12} /> {t("wg_readyIn", { min: String(shop.prepMinutes) })} · </> : null}
          {shop.deliveryRupees ? t("wg_deliveryFeeShort", { fee: rupees(shop.deliveryRupees) }) : <b>{t("wg_freeDelivery")}</b>}
        </span>
      </div>
    </Link>
  );
}
