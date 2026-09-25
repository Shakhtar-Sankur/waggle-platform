import { CakeSlice, Coffee, Flame, Minus, Package, Pill, Plus, UtensilsCrossed, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useT, type TKey } from "../i18n";
import { DietMark } from "../business/BusinessCatalog";
import { licenceFor, type ItemTag, type PublicItem, type PublicShop, type Selection } from "../business/BusinessService";
import { linePrice } from "./cart";
import { rupees } from "./common";

const TAG_LABEL: Record<ItemTag, TKey> = { bestseller: "bx_tagBestseller", chefs_special: "bx_tagChefs", new: "bx_tagNew" };
export const SPICE_LABEL: TKey[] = ["bx_spice0", "bx_spice1", "bx_spice2", "bx_spice3"];

export function ItemBadges({ item }: { item: PublicItem }) {
  const t = useT();
  if (!item.tags.length) return null;
  return <span className="wg-tags">{item.tags.map((tag) => <em key={tag} className={`wg-tag-${tag}`}>{t(TAG_LABEL[tag])}</em>)}</span>;
}

export function Price({ item }: { item: PublicItem }) {
  const t = useT();
  const off = item.mrpRupees && item.mrpRupees > item.priceRupees ? Math.round((1 - item.priceRupees / item.mrpRupees) * 100) : 0;
  return (
    <span className="wg-price">
      <b>{rupees(item.priceRupees)}</b>
      {item.options?.length ? <small className="wg-price-from">{t("wg_onwards")}</small> : null}
      {off ? <><s>{rupees(item.mrpRupees!)}</s><i>{t("wg_off", { n: String(off) })}</i></> : null}
    </span>
  );
}

export function ItemMeta({ item }: { item: PublicItem }) {
  const t = useT();
  const parts = [item.quantityLabel, item.brand].filter(Boolean);
  if (!parts.length && !item.spice) return null;
  return (
    <span className="wg-item-meta">
      {parts.join(" · ")}
      {item.spice ? <span className="wg-spice" title={t(SPICE_LABEL[item.spice])}>{Array.from({ length: item.spice }, (_, k) => <Flame key={k} size={12} />)}</span> : null}
    </span>
  );
}

/** Until the shop adds a photo: a colour of the item's own and an icon for what it is. */
const ART = [["#fde68a", "#f59e0b"], ["#fecaca", "#ef4444"], ["#bbf7d0", "#16a34a"], ["#c7d2fe", "#4f46e5"], ["#fbcfe8", "#db2777"], ["#bae6fd", "#0284c7"]];
export function ItemArt({ item, segmentFood, big }: { item: { name: string; category: string | null }; segmentFood: boolean; big?: boolean }) {
  const words = `${item.category ?? ""} ${item.name}`.toLowerCase();
  const Icon = /drink|coffee|chai|tea|juice|lassi|shake/.test(words) ? Coffee
    : /sweet|dessert|cake|poda|rasgulla|mithai|ice cream/.test(words) ? CakeSlice
    : /medicine|tablet|pharma|syrup/.test(words) ? Pill
    : segmentFood ? UtensilsCrossed : Package;
  let h = 0;
  for (const ch of item.name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [soft, strong] = ART[h % ART.length];
  return (
    <span className={`wg-art${big ? " wg-art-big" : ""}`} style={{ background: `radial-gradient(120% 120% at 20% 10%, #fff 0%, ${soft} 55%, ${soft} 100%)`, color: strong }} aria-hidden>
      <Icon size={big ? 56 : 34} strokeWidth={1.6} />
    </span>
  );
}

/**
 * Tap an item: its photo big, everything the shop wrote about it, its choices
 * (half or full, add-ons, sizes), and add. Required choices start on the first
 * option so one tap adds the usual; the price follows every change.
 */
export function ItemSheet({
  item,
  shop,
  inBasket,
  onAdd,
  onClose,
}: {
  item: PublicItem;
  shop: PublicShop;
  inBasket: number;
  onAdd: (selection: Selection, qty: number) => void;
  onClose: () => void;
}) {
  const t = useT();
  const groups = item.options ?? [];
  const [sel, setSel] = useState<Selection>(() => groups.flatMap((g, i) => (g.required ? [[i, 0] as [number, number]] : [])));
  const [qty, setQty] = useState(1);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const picked = (g: number, c: number) => sel.some(([a, b]) => a === g && b === c);
  function toggle(g: number, c: number) {
    const group = groups[g];
    if (group.max === 1) {
      setSel((s) => (picked(g, c) && !group.required ? s.filter(([a]) => a !== g) : [...s.filter(([a]) => a !== g), [g, c]]));
      return;
    }
    setSel((s) => {
      if (picked(g, c)) return s.filter(([a, b]) => !(a === g && b === c));
      if (s.filter(([a]) => a === g).length >= group.max) return s;
      return [...s, [g, c]];
    });
  }
  const missing = groups.find((g, i) => g.required && !sel.some(([a]) => a === i));
  const total = linePrice(item, sel) * qty;

  return (
    <div className="wg-sheet-backdrop" onClick={onClose}>
      <section className="wg-sheet" role="dialog" aria-modal="true" aria-label={item.name} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="wg-sheet-close" onClick={onClose} aria-label={t("wg_close")}><X size={18} /></button>
        {item.photoUrl ? <img className="wg-sheet-photo" src={item.photoUrl} alt={item.name} /> : <ItemArt item={item} segmentFood={licenceFor(shop.kind) === "fssai"} big />}
        <div className="wg-sheet-body">
          <ItemBadges item={item} />
          <h2><DietMark diet={item.diet} /> {item.name}</h2>
          <Price item={item} />
          <ItemMeta item={item} />
          {item.description ? <p>{item.description}</p> : null}

          {groups.map((g, gi) => (
            <fieldset key={gi} className="wg-optgroup">
              <legend>
                {g.name}
                <small>{g.required ? t("wg_optRequired") : g.max > 1 ? t("wg_optUpTo", { n: String(g.max) }) : t("wg_optOptional")}</small>
              </legend>
              {g.choices.map((c, ci) => (
                <label key={ci} className={`wg-optchoice${picked(gi, ci) ? " is-on" : ""}`}>
                  <input type={g.max === 1 ? "radio" : "checkbox"} name={`g${gi}`} checked={picked(gi, ci)} onChange={() => toggle(gi, ci)} />
                  <span>{c.name}</span>
                  <b>{c.price_paise ? `+ ${rupees(c.price_paise / 100)}` : t("wg_optNoCharge")}</b>
                </label>
              ))}
            </fieldset>
          ))}

          <dl className="wg-facts">
            {item.diet ? <div><dt>{t("bx_diet")}</dt><dd>{t(item.diet === "veg" ? "bx_dietVeg" : item.diet === "egg" ? "bx_dietEgg" : "bx_dietNonVeg")}</dd></div> : null}
            {item.quantityLabel ? <div><dt>{t("wg_quantity")}</dt><dd>{item.quantityLabel}</dd></div> : null}
            {item.spice != null ? <div><dt>{t("bx_spice")}</dt><dd>{t(SPICE_LABEL[item.spice])}</dd></div> : null}
            {item.ingredients ? <div><dt>{t("bx_ingredients")}</dt><dd>{item.ingredients}</dd></div> : null}
            {item.allergens ? <div><dt>{t("bx_allergens")}</dt><dd>{item.allergens}</dd></div> : null}
            {item.brand ? <div><dt>{t("bx_brand")}</dt><dd>{item.brand}</dd></div> : null}
            {item.mrpRupees ? <div><dt>{t("bx_mrp")}</dt><dd>{rupees(item.mrpRupees)}</dd></div> : null}
            {item.stock != null ? <div><dt>{t("wg_inStock")}</dt><dd>{item.soldOut ? t("wg_soldOut") : t("wg_onlyLeft", { n: String(item.stock) })}</dd></div> : null}
            {shop.prepMinutes ? <div><dt>{t("wg_prep")}</dt><dd>{t("wg_readyIn", { min: String(shop.prepMinutes) })}</dd></div> : null}
            {item.sold30d ? <div><dt>{t("wg_popular")}</dt><dd>{t("wg_soldN", { n: String(item.sold30d) })}</dd></div> : null}
          </dl>
          <p className="wg-fine">{t("wg_fromShop", { shop: shop.name })}{inBasket ? ` · ${t("wg_inBasketN", { n: String(inBasket) })}` : ""}</p>
        </div>
        <footer className="wg-sheet-foot">
          {item.soldOut ? (
            <span className="wg-soldout">{t("wg_soldOut")}</span>
          ) : (
            <>
              <div className="wg-stepper">
                <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label={t("bx_less", { name: item.name })}><Minus size={16} /></button>
                <span>{qty}</span>
                <button type="button" onClick={() => setQty((q) => Math.min(20, q + 1))} aria-label={t("bx_more", { name: item.name })}><Plus size={16} /></button>
              </div>
              <button type="button" className="wg-btn wg-btn-primary" disabled={!shop.open || Boolean(missing)}
                onClick={() => { onAdd(sel, qty); onClose(); }}>
                {missing ? t("wg_pickFirst", { group: missing.name.toLowerCase() }) : t("wg_addPrice", { price: rupees(total) })}
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
