import { Flame, ImagePlus, Package, Plus, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "../components/ui/Button";
import { useT, type TKey } from "../i18n";
import { shrinkImage } from "../utils/shrinkImage";
import { BusinessTop, rupees } from "./BusinessScreens";
import { licenceFor, photoUrl, type Business, type CatalogItem, type Diet, type ItemTag, type OptionGroup } from "./BusinessService";

const MEAL_KINDS = ["restaurant", "cafe", "cloud_kitchen", "bakery"];
const DIETS: { id: Diet; label: TKey }[] = [
  { id: "veg", label: "bx_dietVeg" },
  { id: "non_veg", label: "bx_dietNonVeg" },
  { id: "egg", label: "bx_dietEgg" },
];
const TAGS: { id: ItemTag; label: TKey }[] = [
  { id: "bestseller", label: "bx_tagBestseller" },
  { id: "chefs_special", label: "bx_tagChefs" },
  { id: "new", label: "bx_tagNew" },
];
const SPICE: TKey[] = ["bx_spice0", "bx_spice1", "bx_spice2", "bx_spice3"];

type Draft = {
  id?: string;
  name: string;
  category: string;
  price: string;
  description: string;
  available: boolean;
  photoPath: string | null;
  photo: File | null;
  diet: Diet | null;
  quantityLabel: string;
  spice: number | null;
  tags: ItemTag[];
  mrp: string;
  brand: string;
  countStock: boolean;
  stock: string;
  ingredients: string;
  allergens: string;
  options: OptionGroup[];
};

const EMPTY: Draft = {
  name: "", category: "", price: "", description: "", available: true, photoPath: null, photo: null,
  diet: null, quantityLabel: "", spice: null, tags: [], mrp: "", brand: "", countStock: false, stock: "", ingredients: "", allergens: "", options: [],
};

const toDraft = (i: CatalogItem): Draft => ({
  id: i.id, name: i.name, category: i.category ?? "", price: String(i.priceRupees), description: i.description ?? "", available: i.available,
  photoPath: i.photoPath, photo: null, diet: i.diet, quantityLabel: i.quantityLabel ?? "", spice: i.spice, tags: i.tags,
  mrp: i.mrpRupees == null ? "" : String(i.mrpRupees), brand: i.brand ?? "", countStock: i.stock != null, stock: i.stock == null ? "" : String(i.stock),
  ingredients: i.ingredients ?? "", allergens: i.allergens ?? "", options: i.options ?? [],
});

/** The veg / non-veg / egg mark Indian menus use: a coloured dot in a square. */
export function DietMark({ diet }: { diet: Diet | null }) {
  const t = useT();
  if (!diet) return null;
  return <span className={`diet-mark diet-${diet}`} role="img" aria-label={t(diet === "veg" ? "bx_dietVeg" : diet === "egg" ? "bx_dietEgg" : "bx_dietNonVeg")} />;
}

export function CatalogScreen({
  business,
  items,
  onSave,
  onRemove,
  onUploadPhoto,
  nav,
}: {
  business: Business;
  items: CatalogItem[];
  onSave: (item: Omit<CatalogItem, "id"> & { id?: string }) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  /** Puts a photo in the shop's own folder and returns its path. */
  onUploadPhoto: (photo: Blob) => Promise<string>;
  nav?: ReactNode;
}) {
  const t = useT();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const food = licenceFor(business.kind) === "fssai";
  const meal = MEAL_KINDS.includes(business.kind);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const grouped = useMemo(() => {
    const map = new Map<string, CatalogItem[]>();
    for (const item of items) {
      const key = item.category || t("biz_itemOther");
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return [...map.entries()];
  }, [items, t]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const price = Number(draft.price);
    const mrp = draft.mrp ? Number(draft.mrp) : null;
    const stock = draft.countStock ? Number(draft.stock || 0) : null;
    if (!draft.name.trim() || !Number.isFinite(price) || price < 0) return;
    if (mrp != null && (!Number.isFinite(mrp) || mrp < price)) {
      setError(t("bx_mrpErr"));
      return;
    }
    if (stock != null && (!Number.isInteger(stock) || stock < 0)) {
      setError(t("bx_stockErr"));
      return;
    }
    if (draft.options.some((g) => !g.name.trim() || !g.choices.length || g.choices.some((c) => !c.name.trim() || c.price_paise < 0))) {
      setError(t("bx_optErr"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const photoPath = draft.photo ? await onUploadPhoto(await shrinkImage(draft.photo, 1000)) : draft.photoPath;
      await onSave({
        id: draft.id,
        name: draft.name,
        category: draft.category || null,
        description: draft.description || null,
        priceRupees: price,
        available: draft.available,
        photoPath,
        diet: food ? draft.diet : null,
        quantityLabel: draft.quantityLabel || null,
        spice: meal ? draft.spice : null,
        tags: draft.tags,
        mrpRupees: meal ? null : mrp,
        brand: meal ? null : draft.brand || null,
        stock,
        ingredients: meal ? draft.ingredients || null : null,
        allergens: food ? draft.allergens || null : null,
        options: draft.options.map((g) => ({ ...g, name: g.name.trim(), max: Math.max(1, Math.min(g.max, g.choices.length)), choices: g.choices.map((c) => ({ ...c, name: c.name.trim() })) })),
      });
      setDraft(EMPTY);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("biz_errGeneric"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="biz-frame biz-frame-wide">
      <BusinessTop business={business}>
        <div className="biz-top-business"><h1>{t("biz_catalogTitle")}</h1><p>{t("biz_catalogSub")}</p></div>
      </BusinessTop>
      {nav}
      <div className="biz-columns">
        <aside className="biz-side biz-side-always">
          <form className="biz-body" onSubmit={submit}>
            <section className="biz-card">
              <div className="biz-card-head"><strong>{t(draft.id ? "bx_itemEditing" : "bx_itemNew")}</strong></div>
              <label className={`biz-item-photo${draft.photo || draft.photoPath ? " has-photo" : ""}`}>
                <input type="file" accept="image/*" onChange={(e) => set({ photo: e.target.files?.[0] ?? null })} />
                {draft.photo ? <img src={URL.createObjectURL(draft.photo)} alt="" />
                  : draft.photoPath ? <img src={photoUrl(draft.photoPath) ?? ""} alt="" /> : <ImagePlus size={22} />}
                <span>{t(draft.photo || draft.photoPath ? "bx_itemPhotoChange" : "bx_itemPhoto")}<small>{t("bx_itemPhotoHelp")}</small></span>
              </label>
              <label className="biz-field"><span>{t("biz_itemName")}</span>
                <input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder={t("biz_itemNamePh")} maxLength={80} />
              </label>
              {food ? (
                <div className="biz-field">
                  <span>{t("bx_diet")}</span>
                  <div className="biz-chips" role="radiogroup" aria-label={t("bx_diet")}>
                    {DIETS.map((d) => (
                      <button key={d.id} type="button" role="radio" aria-checked={draft.diet === d.id} className={`biz-chip${draft.diet === d.id ? " is-on" : ""}`}
                        onClick={() => set({ diet: draft.diet === d.id ? null : d.id })}>
                        <DietMark diet={d.id} /> {t(d.label)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="biz-row">
                <label className="biz-field"><span>{t("biz_itemCategory")}</span>
                  <input value={draft.category} onChange={(e) => set({ category: e.target.value })} placeholder={t("biz_itemCategoryPh")} maxLength={40} />
                </label>
                <label className="biz-field"><span>{t(meal ? "bx_portion" : "bx_unit")}</span>
                  <input value={draft.quantityLabel} onChange={(e) => set({ quantityLabel: e.target.value })} placeholder={t(meal ? "bx_portionPh" : "bx_unitPh")} maxLength={40} />
                </label>
              </div>
              <div className="biz-row">
                <label className="biz-field"><span>{t("biz_itemPrice")}</span>
                  <input value={draft.price} onChange={(e) => set({ price: e.target.value.replace(/[^\d.]/g, "") })} inputMode="decimal" placeholder="60" />
                </label>
                {!meal ? (
                  <label className="biz-field"><span>{t("bx_mrp")}</span>
                    <input value={draft.mrp} onChange={(e) => set({ mrp: e.target.value.replace(/[^\d.]/g, "") })} inputMode="decimal" placeholder={t("bx_mrpPh")} />
                  </label>
                ) : (
                  <div className="biz-field">
                    <span>{t("bx_spice")}</span>
                    <div className="biz-spice" role="radiogroup" aria-label={t("bx_spice")}>
                      {SPICE.map((label, n) => (
                        <button key={label} type="button" role="radio" aria-checked={draft.spice === n} title={t(label)}
                          className={draft.spice === n ? "is-on" : ""} onClick={() => set({ spice: draft.spice === n ? null : n })}>
                          {n === 0 ? t("bx_spiceNone") : Array.from({ length: n }, (_, k) => <Flame key={k} size={13} />)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {!meal ? (
                <label className="biz-field"><span>{t("bx_brand")}</span>
                  <input value={draft.brand} onChange={(e) => set({ brand: e.target.value })} placeholder={t("bx_brandPh")} maxLength={40} />
                </label>
              ) : null}
              <label className="biz-field"><span>{t("biz_itemDescription")}</span>
                <input value={draft.description} onChange={(e) => set({ description: e.target.value })} placeholder={t("bx_descPh")} maxLength={300} />
              </label>
              {meal ? (
                <label className="biz-field"><span>{t("bx_ingredients")}</span>
                  <input value={draft.ingredients} onChange={(e) => set({ ingredients: e.target.value })} placeholder={t("bx_ingredientsPh")} maxLength={300} />
                </label>
              ) : null}
              {food ? (
                <label className="biz-field"><span>{t("bx_allergens")}</span>
                  <input value={draft.allergens} onChange={(e) => set({ allergens: e.target.value })} placeholder={t("bx_allergensPh")} maxLength={120} />
                </label>
              ) : null}
              <OptionsEditor value={draft.options} onChange={(options) => set({ options })} meal={meal} />
              <div className="biz-field">
                <span>{t("bx_tags")}</span>
                <div className="biz-chips">
                  {TAGS.map((tag) => (
                    <button key={tag.id} type="button" aria-pressed={draft.tags.includes(tag.id)} className={`biz-chip${draft.tags.includes(tag.id) ? " is-on" : ""}`}
                      onClick={() => set({ tags: draft.tags.includes(tag.id) ? draft.tags.filter((x) => x !== tag.id) : [...draft.tags, tag.id] })}>
                      {t(tag.label)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="biz-row biz-row-end">
                <label className="biz-check">
                  <input type="checkbox" checked={draft.countStock} onChange={(e) => set({ countStock: e.target.checked })} />
                  <span>{t("bx_countStock")}</span>
                </label>
                {draft.countStock ? (
                  <label className="biz-field"><span>{t("bx_stockNow")}</span>
                    <input value={draft.stock} onChange={(e) => set({ stock: e.target.value.replace(/\D/g, "") })} inputMode="numeric" placeholder="10" />
                  </label>
                ) : null}
              </div>
              <label className="biz-check">
                <input type="checkbox" checked={draft.available} onChange={(e) => set({ available: e.target.checked })} />
                <span>{t("biz_itemAvailable")}</span>
              </label>
              {error ? <p className="biz-error" role="alert">{error}</p> : null}
              <div className="biz-decide">
                <Button type="submit" disabled={busy || !draft.name.trim() || !draft.price}>{t(draft.id ? "biz_itemSave" : "biz_itemAdd")}</Button>
                {draft.id ? <Button variant="ghost" onClick={() => setDraft(EMPTY)}>{t("biz_back")}</Button> : null}
              </div>
            </section>
          </form>
        </aside>
        <div className="biz-body">
          {items.length === 0 ? (
            <section className="biz-card"><div className="biz-empty"><Package size={22} /><p>{t("biz_catalogEmpty")}</p></div></section>
          ) : (
            grouped.map(([category, list]) => (
              <section key={category} className="biz-card">
                <div className="biz-card-head"><strong>{category}</strong><span className="biz-muted">{list.length}</span></div>
                <ul className="biz-items">
                  {list.map((item) => (
                    <li key={item.id} className={item.available ? "" : "is-hidden"}>
                      {item.photoPath ? <img className="biz-item-thumb" src={photoUrl(item.photoPath) ?? ""} alt="" /> : null}
                      <div>
                        <strong><DietMark diet={item.diet} /> {item.name}</strong>
                        {item.options?.length ? <span className="biz-item-meta">{item.options.map((g) => `${g.name}: ${g.choices.map((c) => c.name).join(" / ")}`).join(" · ")}</span> : null}
                        <span className="biz-item-meta">
                          {[item.quantityLabel, item.brand, item.stock == null ? null : item.stock === 0 ? t("bx_soldOut") : t("bx_stockLeft", { n: String(item.stock) })]
                            .filter(Boolean).join(" · ")}
                        </span>
                        {item.tags.length ? <span className="biz-item-tags">{item.tags.map((tag) => <em key={tag}>{t(TAGS.find((x) => x.id === tag)!.label)}</em>)}</span> : null}
                        {!item.available ? <em>{t("biz_itemHidden")}</em> : null}
                      </div>
                      <b>
                        {rupees(item.priceRupees)}
                        {item.mrpRupees && item.mrpRupees > item.priceRupees ? <s>{rupees(item.mrpRupees)}</s> : null}
                      </b>
                      <div className="biz-item-actions">
                        <Button variant="ghost" size="sm" onClick={() => setDraft(toDraft(item))}>{t("biz_itemEdit")}</Button>
                        <Button variant="ghost" size="sm" onClick={() => void onRemove(item.id)}>{t("biz_itemDelete")}</Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/** Choices on an item: Half / Full, add-ons, sizes. Each choice adds its price to the item's. */
function OptionsEditor({ value, onChange, meal }: { value: OptionGroup[]; onChange: (v: OptionGroup[]) => void; meal: boolean }) {
  const t = useT();
  const setGroup = (i: number, patch: Partial<OptionGroup>) => onChange(value.map((g, k) => (k === i ? { ...g, ...patch } : g)));
  const rupeesOf = (paise: number) => (paise ? String(paise / 100) : "");
  return (
    <div className="biz-field biz-options">
      <span>{t("bx_options")}</span>
      <p className="biz-help">{t(meal ? "bx_optionsHelpMeal" : "bx_optionsHelpShop")}</p>
      {value.map((g, i) => (
        <div key={i} className="biz-optgroup">
          <div className="biz-optgroup-head">
            <input value={g.name} onChange={(e) => setGroup(i, { name: e.target.value })} placeholder={t("bx_optGroupPh")} maxLength={30} aria-label={t("bx_optGroup")} />
            <label className="biz-check"><input type="checkbox" checked={g.required} onChange={(e) => setGroup(i, { required: e.target.checked })} /> <span>{t("bx_optRequired")}</span></label>
            <label className="biz-optmax">{t("bx_optMax")}
              <input value={String(g.max)} inputMode="numeric" onChange={(e) => setGroup(i, { max: Math.max(1, Math.min(15, Number(e.target.value.replace(/\D/g, "") || 1))) })} />
            </label>
            <button type="button" className="biz-icon-link biz-icon-danger" aria-label={t("biz_itemDelete")} onClick={() => onChange(value.filter((_, k) => k !== i))}><Trash2 size={15} /></button>
          </div>
          {g.choices.map((c, j) => (
            <div key={j} className="biz-optchoice">
              <input value={c.name} onChange={(e) => setGroup(i, { choices: g.choices.map((x, k) => (k === j ? { ...x, name: e.target.value } : x)) })} placeholder={t("bx_optChoicePh")} maxLength={40} />
              <label>+ ₹<input value={rupeesOf(c.price_paise)} inputMode="decimal" placeholder="0"
                onChange={(e) => setGroup(i, { choices: g.choices.map((x, k) => (k === j ? { ...x, price_paise: Math.round(Number(e.target.value.replace(/[^\d.]/g, "") || 0) * 100) } : x)) })} /></label>
              <button type="button" className="biz-icon-link biz-icon-danger" aria-label={t("biz_itemDelete")} onClick={() => setGroup(i, { choices: g.choices.filter((_, k) => k !== j) })}><Trash2 size={14} /></button>
            </div>
          ))}
          {g.choices.length < 15 ? (
            <button type="button" className="biz-link" onClick={() => setGroup(i, { choices: [...g.choices, { name: "", price_paise: 0 }] })}><Plus size={14} /> {t("bx_optAddChoice")}</button>
          ) : null}
        </div>
      ))}
      {value.length < 5 ? (
        <div className="biz-chips">
          {meal ? (
            <>
              <button type="button" className="biz-chip" onClick={() => onChange([...value, { name: "Size", required: true, max: 1, choices: [{ name: "Half", price_paise: 0 }, { name: "Full", price_paise: 0 }] }])}><Plus size={13} /> {t("bx_optHalfFull")}</button>
              <button type="button" className="biz-chip" onClick={() => onChange([...value, { name: "Add-ons", required: false, max: 3, choices: [{ name: "", price_paise: 0 }] }])}><Plus size={13} /> {t("bx_optAddons")}</button>
            </>
          ) : (
            <button type="button" className="biz-chip" onClick={() => onChange([...value, { name: "Size", required: true, max: 1, choices: [{ name: "", price_paise: 0 }] }])}><Plus size={13} /> {t("bx_optSizes")}</button>
          )}
          <button type="button" className="biz-chip" onClick={() => onChange([...value, { name: "", required: false, max: 1, choices: [{ name: "", price_paise: 0 }] }])}><Plus size={13} /> {t("bx_optOwn")}</button>
        </div>
      ) : null}
    </div>
  );
}
