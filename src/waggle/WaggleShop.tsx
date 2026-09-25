import { BadgePercent, Bike, Clock3, MessageSquareQuote, Minus, PackageCheck, Phone, Plus, Search, ShoppingBag, Star, Store, Timer, TrendingUp, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useT, type TKey } from "../i18n";
import { DietMark } from "../business/BusinessCatalog";
import { BusinessService, licenceFor, type PublicItem, type PublicShop, type Selection } from "../business/BusinessService";
import { addToCart, countOf, hasOptions, linePrice, removeOne, type CartLine } from "./cart";
import { Checkout } from "./Checkout";
import { rememberGroup, rememberOrder, rupees, takeReorder, WgFrame } from "./common";
import { ItemArt, ItemBadges, ItemMeta, ItemSheet, Price } from "./ItemParts";

/**
 * A shop in the Waggle app: offers, bestsellers from real orders, the menu with
 * every choice the shop offers, reviews, and ordering alone or with friends.
 * Prices and every limit come from the database; this page shows them.
 */
export function ShopPage() {
  const t = useT();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [shop, setShop] = useState<PublicShop | null | undefined>(undefined);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [query, setQuery] = useState("");
  const [vegOnly, setVegOnly] = useState(false);
  const [open, setOpen] = useState<PublicItem | null>(null);
  const [checkout, setCheckout] = useState(false);
  const [coupon, setCoupon] = useState<string | null>(null);
  const [grouping, setGrouping] = useState(false);
  const sections = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    let live = true;
    BusinessService.publicShop(id)
      .then((s) => {
        if (!live) return;
        setShop(s);
        // "Order again" from a past order refills the basket with what is still sold.
        if (s) setLines(takeReorder(id).filter((l) => s.items.some((i) => i.id === l.itemId)).reduce((acc, l) => addToCart(acc, l.itemId, l.selection, l.qty), [] as CartLine[]));
      })
      .catch(() => live && setShop(null));
    return () => { live = false; };
  }, [id]);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<string, PublicItem[]>();
    for (const item of shop?.items ?? []) {
      if (vegOnly && item.diet !== "veg") continue;
      if (q && !`${item.name} ${item.description ?? ""} ${item.category ?? ""} ${item.brand ?? ""}`.toLowerCase().includes(q)) continue;
      const key = item.category || t("biz_itemOther");
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return [...map.entries()];
  }, [shop, query, vegOnly, t]);

  // What really sells here: delivered at least twice in the last 30 days.
  const bestsellers = useMemo(
    () => (shop?.items ?? []).filter((i) => i.sold30d >= 2 && !i.soldOut && (!vegOnly || i.diet === "veg")).sort((a, b) => b.sold30d - a.sold30d).slice(0, 6),
    [shop, vegOnly],
  );

  if (shop === undefined) return <WgFrame><p className="wg-loading">{t("biz_loading")}</p></WgFrame>;
  if (shop === null) {
    return (
      <WgFrame>
        <main className="wg-page">
          <section className="wg-card wg-empty"><Store size={28} /><h2>{t("wg_shopMissing")}</h2><p>{t("wg_shopMissingSub")}</p></section>
        </main>
      </WgFrame>
    );
  }

  const byId = new Map(shop.items.map((i) => [i.id, i]));
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const subtotal = lines.reduce((s, l) => s + (byId.get(l.itemId) ? linePrice(byId.get(l.itemId)!, l.selection) * l.qty : 0), 0);
  const food = licenceFor(shop.kind) === "fssai";
  const addLine = (itemId: string, selection: Selection, qty: number) => setLines((ls) => addToCart(ls, itemId, selection, qty));
  // Items with choices open their page; plain items add straight away.
  const plus = (item: PublicItem) => (hasOptions(item) ? setOpen(item) : addLine(item.id, [], 1));
  const minus = (item: PublicItem) => setLines((ls) => removeOne(ls, item.id));

  if (checkout && count) {
    return (
      <Checkout
        shop={shop}
        lines={lines}
        onChange={(line, by) => setLines((ls) => addToCart(ls, line.itemId, line.selection, by))}
        preferredCoupon={coupon}
        onBack={() => setCheckout(false)}
        onPlaced={(token, code) => {
          rememberOrder({ token, code, shop: shop.name, shopId: shop.id, at: new Date().toISOString() });
          navigate(`/order/${token}`, { replace: true });
        }}
      />
    );
  }

  const stepper = (item: PublicItem, small?: boolean) => {
    const n = countOf(lines, item.id);
    if (item.soldOut) return <span className="wg-soldout">{t("wg_soldOut")}</span>;
    if (!n) {
      return (
        <span className="wg-addwrap">
          <button type="button" className={`wg-add${small ? " wg-add-sm" : ""}`} disabled={!shop.open} onClick={() => plus(item)}>{t("wg_add")}</button>
          {hasOptions(item) ? <small className="wg-custom">{t("wg_customisable")}</small> : null}
        </span>
      );
    }
    return (
      <div className={`wg-stepper${small ? " wg-stepper-sm" : ""}`}>
        <button type="button" onClick={() => minus(item)} aria-label={t("bx_less", { name: item.name })}><Minus size={small ? 13 : 15} /></button>
        <span>{n}</span>
        <button type="button" onClick={() => plus(item)} aria-label={t("bx_more", { name: item.name })}><Plus size={small ? 13 : 15} /></button>
      </div>
    );
  };

  return (
    <WgFrame>
      <main className="wg-page wg-shop">
        <section className="wg-shop-hero">
          <span className="wg-shop-logo" aria-hidden>{shop.name.slice(0, 1)}</span>
          <div>
            <h1>{shop.name}</h1>
            <p>{t(`bx_kind_${shop.kind}` as TKey)} · {shop.address}</p>
            <div className="wg-pills">
              <span className={shop.open ? "is-open" : "is-closed"}><Clock3 size={13} /> {t(shop.open ? "wg_open" : "wg_closed")}</span>
              {shop.ratings ? <span><Star size={13} fill="currentColor" /> {shop.rating?.toFixed(1)} ({shop.ratings})</span> : <span>{t("wg_new")}</span>}
              <span><Bike size={13} /> {shop.deliveryRupees ? t("wg_deliveryFeeShort", { fee: rupees(shop.deliveryRupees) }) : t("wg_freeDelivery")}</span>
              <span><PackageCheck size={13} /> {t("wg_payOnDeliveryShort")}</span>
              {shop.prepMinutes ? <span><Timer size={13} /> {t("wg_readyIn", { min: String(shop.prepMinutes) })}</span> : null}
            </div>
          </div>
          {shop.phone ? <a className="wg-round" href={`tel:${shop.phone}`} aria-label={t("wg_callShop")}><Phone size={18} /></a> : null}
        </section>
        {!shop.open ? <p className="wg-banner">{t("wg_closedNote")}</p> : null}

        {shop.offers.length ? (
          <div className="wg-offer-strip" aria-label={t("wg_offers")}>
            {shop.offers.map((o) => (
              <button key={o.code} type="button" className={`wg-offer-chip${coupon === o.code ? " is-on" : ""}`} onClick={() => setCoupon(coupon === o.code ? null : o.code)}>
                <BadgePercent size={18} />
                <span><strong>{o.title}</strong><small>{coupon === o.code ? t("wg_offerChosen") : t("wg_offerUse", { code: o.code })}</small></span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="wg-shop-tools">
          <label className="wg-search">
            <Search size={16} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("wg_searchPh", { shop: shop.name })} />
          </label>
          <nav className="wg-cats" aria-label={t("wg_categories")}>
            {food ? (
              <label className={`wg-vegonly${vegOnly ? " is-on" : ""}`}>
                <input type="checkbox" checked={vegOnly} onChange={(e) => setVegOnly(e.target.checked)} />
                <DietMark diet="veg" /> {t("wg_vegOnly")}
              </label>
            ) : null}
            {shop.open ? <button type="button" className="wg-together" onClick={() => setGrouping(true)}><Users size={14} /> {t("wg_together")}</button> : null}
            {grouped.length > 1 && !query ? grouped.map(([category, list]) => (
              <button key={category} type="button" onClick={() => sections.current[category]?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                {category} <small>{list.length}</small>
              </button>
            )) : null}
          </nav>
        </div>

        {bestsellers.length && !query ? (
          <section className="wg-section">
            <h2 className="wg-section-title"><TrendingUp size={17} /> {t("wg_bestsellers")}</h2>
            <div className="wg-best">
              {bestsellers.map((item) => (
                <article key={item.id} className="wg-best-card">
                  <button type="button" className="wg-best-open" onClick={() => setOpen(item)}>
                    {item.photoUrl ? <img src={item.photoUrl} alt="" loading="lazy" /> : <ItemArt item={item} segmentFood={food} />}
                    <span className="wg-best-sold"><TrendingUp size={11} /> {t("wg_soldN", { n: String(item.sold30d) })}</span>
                  </button>
                  <div className="wg-best-body">
                    <strong><DietMark diet={item.diet} /> {item.name}</strong>
                    {item.quantityLabel ? <small>{item.quantityLabel}</small> : null}
                    <div className="wg-best-foot"><Price item={item} />{stepper(item, true)}</div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {grouped.length === 0 ? (
          <section className="wg-card wg-empty"><ShoppingBag size={26} /><p>{query ? t("wg_noMatch", { q: query }) : t("wg_shopEmpty")}</p></section>
        ) : (
          grouped.map(([category, list]) => (
            <section key={category} className="wg-section" ref={(el) => { sections.current[category] = el; }}>
              <h2 className="wg-section-title">{category} <small>{list.length}</small></h2>
              <ul className="wg-items">
                {list.map((item) => (
                  <li key={item.id} className={`wg-item${item.soldOut ? " is-soldout" : ""}`}>
                    <button type="button" className="wg-item-text" onClick={() => setOpen(item)}>
                      <ItemBadges item={item} />
                      <strong><DietMark diet={item.diet} /> {item.name}</strong>
                      <Price item={item} />
                      <ItemMeta item={item} />
                      {item.description ? <span className="wg-item-desc">{item.description}</span> : null}
                    </button>
                    <div className="wg-item-side">
                      {item.photoUrl ? <button type="button" className="wg-item-photo" onClick={() => setOpen(item)}><img src={item.photoUrl} alt={item.name} loading="lazy" /></button> : null}
                      {stepper(item)}
                      {item.stock != null && item.stock > 0 && item.stock <= 5 ? <small className="wg-few">{t("wg_onlyLeft", { n: String(item.stock) })}</small> : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}

        <Reviews shop={shop} />
        <p className="wg-fine wg-center">{t("wg_deliveredBy")}</p>
      </main>
      {open ? (
        <ItemSheet item={open} shop={shop} inBasket={countOf(lines, open.id)} onAdd={(sel, qty) => addLine(open.id, sel, qty)} onClose={() => setOpen(null)} />
      ) : null}
      {grouping ? <StartGroup shop={shop} onClose={() => setGrouping(false)} onStarted={(token) => navigate(`/group/${token}`)} /> : null}
      {count ? (
        <div className="wg-cartbar">
          <div><b>{t("wg_itemsN", { count: String(count) })}</b><span>{rupees(subtotal)} {t("wg_plusDelivery")}{coupon ? ` · ${coupon}` : ""}</span></div>
          <button type="button" className="wg-btn wg-btn-light" disabled={!shop.open} onClick={() => setCheckout(true)}>{t("wg_viewBasket")}</button>
        </div>
      ) : null}
    </WgFrame>
  );
}

/** What customers wrote, with their photos and the shop's replies. First names only. */
function Reviews({ shop }: { shop: PublicShop }) {
  const t = useT();
  if (!shop.ratings && !shop.reviews.length) return null;
  return (
    <section className="wg-section">
      <h2 className="wg-section-title"><MessageSquareQuote size={17} /> {t("wg_reviewsTitle")}</h2>
      {shop.ratings ? (
        <div className="wg-rating-summary">
          <b>{shop.rating?.toFixed(1)}</b>
          <span className="wg-stars-static">{[1, 2, 3, 4, 5].map((n) => <Star key={n} size={16} fill={n <= Math.round(shop.rating ?? 0) ? "currentColor" : "none"} />)}</span>
          <small>{t("wg_ratingsN", { n: String(shop.ratings) })}</small>
        </div>
      ) : null}
      <div className="wg-reviews">
        {shop.reviews.map((r, i) => (
          <article key={i} className="wg-review">
            <header>
              <span className="wg-avatar wg-avatar-sm">{r.name.slice(0, 1).toUpperCase()}</span>
              <span><strong>{r.name}</strong><small>{new Date(r.at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</small></span>
              <em className="wg-rating"><Star size={11} fill="currentColor" /> {r.stars}</em>
            </header>
            {r.comment ? <p>{r.comment}</p> : null}
            {r.photoUrl ? <img src={r.photoUrl} alt="" loading="lazy" /> : null}
            {r.reply ? <blockquote><strong>{t("wg_shopReplied", { shop: shop.name })}</strong>{r.reply}</blockquote> : null}
          </article>
        ))}
      </div>
    </section>
  );
}

/** Start a group basket: one link for friends, and this phone keeps the key that places it. */
function StartGroup({ shop, onClose, onStarted }: { shop: PublicShop; onClose: () => void; onStarted: (token: string) => void }) {
  const t = useT();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function start() {
    setBusy(true);
    setError("");
    try {
      const g = await BusinessService.createGroupCart(shop.id, name);
      rememberGroup(g.token, { hostKey: g.hostKey, member: name.trim() });
      onStarted(g.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("biz_errGeneric"));
      setBusy(false);
    }
  }
  return (
    <div className="wg-sheet-backdrop" onClick={onClose}>
      <section className="wg-sheet wg-small-sheet" role="dialog" aria-modal="true" aria-label={t("wg_together")} onClick={(e) => e.stopPropagation()}>
        <div className="wg-sheet-body">
          <span className="wg-soon-icon"><Users size={26} /></span>
          <h2>{t("wg_togetherTitle")}</h2>
          <p>{t("wg_togetherSub", { shop: shop.name })}</p>
          <input className="wg-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("wg_yourNamePh")} maxLength={30} autoFocus />
          {error ? <p className="wg-error">{error}</p> : null}
        </div>
        <footer className="wg-sheet-foot">
          <button type="button" className="wg-btn wg-btn-ghost" onClick={onClose}>{t("wg_cancelNo")}</button>
          <button type="button" className="wg-btn wg-btn-primary" disabled={busy || !name.trim()} onClick={() => void start()}>{t("wg_startGroup")}</button>
        </footer>
      </section>
    </div>
  );
}
