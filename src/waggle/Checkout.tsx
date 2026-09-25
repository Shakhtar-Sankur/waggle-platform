import { BadgePercent, CalendarClock, ChevronLeft, LocateFixed, Minus, Plus, Zap } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useT } from "../i18n";
import { LocationService } from "../services/LocationService";
import { useAuthStore } from "../stores/useAuthStore";
import { DietMark } from "../business/BusinessCatalog";
import { BusinessService, estimate, MAX_DELIVERY_KM, offerDiscount, type GroupLine, type PublicShop } from "../business/BusinessService";
import { MapPicker, type LatLng } from "../business/MapPicker";
import { linePrice, optionLabels, type CartLine } from "./cart";
import { rupees, savedContact, saveContact, WgFrame } from "./common";
import { LABEL_KEY } from "./LocationSheet";
import { useWaggleLocation } from "./useWaggleLocation";
import { WaggleService, type SavedAddress } from "./WaggleService";

/** A local date-time value for an <input type="datetime-local">. */
const localValue = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

/**
 * The last step, for one person's basket or a group's. Everything shown is an
 * estimate the database repeats: prices, the coupon's saving, the schedule.
 */
export function Checkout({
  shop,
  lines,
  onChange,
  group,
  preferredCoupon,
  onBack,
  onPlaced,
}: {
  shop: PublicShop;
  lines: CartLine[];
  onChange?: (line: CartLine, by: number) => void;
  /** A group basket: its lines, and the host's key that lets this phone place it. */
  group?: { token: string; hostKey: string; lines: GroupLine[] };
  preferredCoupon?: string | null;
  onBack: () => void;
  onPlaced: (token: string, code: string) => void;
}) {
  const t = useT();
  const user = useAuthStore((s) => s.user);
  const homePlace = useWaggleLocation((s) => s.place);
  const saved = savedContact();
  // The place chosen on the home screen wins over the last order's; a GPS fix has no written address yet.
  const fromPlace = homePlace && homePlace.label !== "gps" ? homePlace : null;
  const [name, setName] = useState(saved?.name ?? user?.fullName ?? "");
  const [phone, setPhone] = useState(saved?.phone ?? user?.phone?.replace(/^\+91/, "") ?? "");
  const [area, setArea] = useState(fromPlace?.area ?? saved?.area ?? "");
  const [address, setAddress] = useState(fromPlace?.address ?? saved?.address ?? "");
  const [note, setNote] = useState("");
  const [pin, setPin] = useState<LatLng | null>(
    homePlace ? { lat: homePlace.lat, lng: homePlace.lng } : saved?.lat != null && saved?.lng != null ? { lat: saved.lat, lng: saved.lng } : null,
  );
  const [places, setPlaces] = useState<SavedAddress[]>([]);
  const [keep, setKeep] = useState(false);
  const [coupon, setCoupon] = useState(preferredCoupon ?? "");
  const [applied, setApplied] = useState<string | null>(preferredCoupon ?? null);
  const [when, setWhen] = useState<"now" | "later">("now");
  const [later, setLater] = useState(localValue(new Date(Date.now() + 60 * 60000)));
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (user) void WaggleService.addresses().then(setPlaces).catch(() => undefined); }, [user]);

  const byId = new Map(shop.items.map((i) => [i.id, i]));
  const rows = group
    ? group.lines.map((l) => ({ key: l.id, name: l.name, diet: l.diet, qty: l.qty, unit: l.unitRupees, opts: l.options.map((o) => o.choice).join(", "), member: l.member, line: null as CartLine | null }))
    : lines.flatMap((l) => {
        const item = byId.get(l.itemId);
        return item ? [{ key: l.key, name: item.name, diet: item.diet, qty: l.qty, unit: linePrice(item, l.selection), opts: optionLabels(item, l.selection), member: null as string | null, line: l }] : [];
      });
  const subtotal = rows.reduce((s, r) => s + r.unit * r.qty, 0);
  const offer = applied ? shop.offers.find((o) => o.code === applied) ?? null : null;
  const discount = offer ? offerDiscount(offer, Math.round(subtotal * 100)) / 100 : 0;
  const total = subtotal - discount + shop.deliveryRupees;
  const tooFar = pin ? estimate(shop.lat, shop.lng, pin.lat, pin.lng).straightKm > MAX_DELIVERY_KM : false;
  const digits = phone.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
  const phoneOk = /^[6-9]\d{9}$/.test(digits);
  const laterOk = when === "now" || (new Date(later).getTime() >= Date.now() + 30 * 60000 && new Date(later).getTime() <= Date.now() + 7 * 86400000);
  const ready = rows.length > 0 && name.trim().length >= 2 && phoneOk && area.trim().length >= 2 && address.trim().length >= 5 && pin && !tooFar && laterOk;

  async function locate() {
    setLocating(true);
    setError("");
    try {
      const p = await LocationService.currentPosition();
      setPin({ lat: p.lat, lng: p.lng });
    } catch {
      setError(t("wg_locateFailed"));
    } finally {
      setLocating(false);
    }
  }

  async function place(event: FormEvent) {
    event.preventDefault();
    if (!ready || !pin || busy) return;
    setBusy(true);
    setError("");
    const details = {
      name, phone: digits, area, address, lat: pin.lat, lng: pin.lng, note, coupon: applied,
      scheduledFor: when === "later" ? new Date(later).toISOString() : null,
    };
    try {
      const placed = group
        ? await BusinessService.placeGroupOrder(group.token, group.hostKey, details)
        : await BusinessService.placeOrder({ businessId: shop.id, ...details, items: lines.map((l) => ({ id: l.itemId, qty: l.qty, options: l.selection })) });
      saveContact({ name: name.trim(), phone: digits, area: area.trim(), address: address.trim(), lat: pin.lat, lng: pin.lng });
      if (user && keep) {
        await WaggleService.saveAddress({ label: places.some((a) => a.label === "home") ? "other" : "home", area, address, lat: pin.lat, lng: pin.lng }).catch(() => undefined);
      }
      onPlaced(placed.token, placed.code);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("biz_errGeneric"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <WgFrame bar={<button type="button" className="wg-back" onClick={onBack}><ChevronLeft size={18} /> {shop.name}</button>}>
      <form className="wg-page" onSubmit={place}>
        <h1 className="wg-title">{t(group ? "wg_groupCheckout" : "wg_checkout")}</h1>

        <section className="wg-card">
          <h2 className="wg-h2">{t("wg_yourOrder")}</h2>
          <ul className="wg-lines">
            {rows.map((r) => (
              <li key={r.key}>
                <span>
                  <strong><DietMark diet={r.diet} /> {r.name}</strong>
                  {r.opts ? <small>{r.opts}</small> : null}
                  {r.member ? <small className="wg-line-member">{t("wg_forMember", { name: r.member })}</small> : null}
                  <small>{rupees(r.unit)}</small>
                </span>
                {r.line && onChange ? (
                  <div className="wg-stepper wg-stepper-sm">
                    <button type="button" onClick={() => onChange(r.line!, -1)} aria-label={t("bx_less", { name: r.name })}><Minus size={13} /></button>
                    <span>{r.qty}</span>
                    <button type="button" onClick={() => onChange(r.line!, 1)} aria-label={t("bx_more", { name: r.name })}><Plus size={13} /></button>
                  </div>
                ) : <span className="wg-qty">× {r.qty}</span>}
                <b>{rupees(r.unit * r.qty)}</b>
              </li>
            ))}
          </ul>
          <textarea className="wg-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("wg_notePh")} maxLength={300} rows={2} />
        </section>

        <section className="wg-card">
          <h2 className="wg-h2"><BadgePercent size={17} /> {t("wg_offers")}</h2>
          {shop.offers.length ? (
            <div className="wg-offer-list">
              {shop.offers.map((o) => {
                const saves = offerDiscount(o, Math.round(subtotal * 100)) / 100;
                return (
                  <button key={o.code} type="button" className={`wg-offer${applied === o.code ? " is-on" : ""}`}
                    onClick={() => { setApplied(applied === o.code ? null : o.code); setCoupon(o.code); }}>
                    <code>{o.code}</code>
                    <span><strong>{o.title}</strong><small>{saves ? t("wg_offerSaves", { amount: rupees(saves) }) : t("wg_offerMin", { amount: rupees(o.minOrderPaise / 100) })}</small></span>
                    <em>{t(applied === o.code ? "wg_offerApplied" : "wg_offerApply")}</em>
                  </button>
                );
              })}
            </div>
          ) : null}
          <div className="wg-coupon-row">
            <input className="wg-input" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder={t("wg_couponPh")} maxLength={15} />
            <button type="button" className="wg-btn wg-btn-soft" disabled={!coupon} onClick={() => setApplied(coupon)}>{t("wg_offerApply")}</button>
          </div>
          {applied && !offer ? <p className="wg-fine">{t("wg_couponChecked", { code: applied })}</p> : null}
          {offer && !discount ? <p className="wg-error">{t("wg_offerMin", { amount: rupees(offer.minOrderPaise / 100) })}</p> : null}
        </section>

        <section className="wg-card">
          <h2 className="wg-h2">{t("wg_when")}</h2>
          <div className="wg-when">
            <button type="button" className={when === "now" ? "is-on" : ""} onClick={() => setWhen("now")}>
              <Zap size={16} /> <span><strong>{t("wg_now")}</strong><small>{shop.prepMinutes ? t("wg_readyIn", { min: String(shop.prepMinutes) }) : t("wg_asap")}</small></span>
            </button>
            <button type="button" className={when === "later" ? "is-on" : ""} onClick={() => setWhen("later")}>
              <CalendarClock size={16} /> <span><strong>{t("wg_schedule")}</strong><small>{t("wg_scheduleSub")}</small></span>
            </button>
          </div>
          {when === "later" ? (
            <>
              <input className="wg-input" type="datetime-local" value={later} onChange={(e) => setLater(e.target.value)}
                min={localValue(new Date(Date.now() + 30 * 60000))} max={localValue(new Date(Date.now() + 7 * 86400000))} />
              {!laterOk ? <p className="wg-error">{t("wg_scheduleErr")}</p> : null}
            </>
          ) : null}
        </section>

        <section className="wg-card">
          <div className="wg-h2-row">
            <h2 className="wg-h2">{t("wg_deliverTo")}</h2>
            <button type="button" className="wg-link" onClick={() => void locate()} disabled={locating}>
              <LocateFixed size={15} /> {locating ? t("biz_locating") : t("wg_useLocation")}
            </button>
          </div>
          {places.length ? (
            <div className="wg-chips wg-placechips">
              {places.map((a) => (
                <button key={a.id} type="button" className={pin?.lat === a.lat && pin?.lng === a.lng ? "is-on" : ""}
                  onClick={() => { setPin({ lat: a.lat, lng: a.lng }); setArea(a.area); setAddress(a.address); }}>
                  {t(LABEL_KEY[a.label])} · {a.area}
                </button>
              ))}
            </div>
          ) : null}
          <MapPicker value={pin} onChange={setPin} anchor={{ lat: shop.lat, lng: shop.lng }} height={220} />
          {tooFar ? <p className="wg-error">{t("wg_tooFar", { km: String(MAX_DELIVERY_KM) })}</p> : <p className="wg-fine">{t("wg_pinHelp")}</p>}
          <label className="wg-field"><span>{t("wg_area")}</span>
            <input className="wg-input" value={area} onChange={(e) => setArea(e.target.value)} placeholder={t("biz_areaPh")} maxLength={60} autoComplete="address-level3" />
          </label>
          <label className="wg-field"><span>{t("wg_address")}</span>
            <input className="wg-input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t("wg_addressPh")} maxLength={200} autoComplete="street-address" />
          </label>
          {user && !places.some((a) => pin && a.lat === pin.lat && a.lng === pin.lng) ? (
            <label className="wg-keep"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> {t("wg_keepPlace")}</label>
          ) : null}
        </section>

        <section className="wg-card">
          <h2 className="wg-h2">{t("wg_contact")}</h2>
          <div className="wg-row">
            <label className="wg-field"><span>{t("wg_name")}</span>
              <input className="wg-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={60} />
            </label>
            <label className="wg-field"><span>{t("wg_phone")}</span>
              <input className="wg-input" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="98765 43210" maxLength={16} />
            </label>
          </div>
          {phone && !phoneOk ? <p className="wg-error">{t("wg_phoneErr")}</p> : <p className="wg-fine">{t("wg_phoneWhy", { shop: shop.name })}</p>}
        </section>

        <section className="wg-card wg-bill">
          <h2 className="wg-h2">{t("wg_bill")}</h2>
          <dl>
            <div><dt>{t("wg_itemTotal", { count: String(rows.reduce((s, r) => s + r.qty, 0)) })}</dt><dd>{rupees(subtotal)}</dd></div>
            {discount ? <div className="wg-saving"><dt>{t("wg_couponLine", { code: applied ?? "" })}</dt><dd>− {rupees(discount)}</dd></div> : null}
            <div><dt>{t("wg_deliveryFee")}</dt><dd>{shop.deliveryRupees ? rupees(shop.deliveryRupees) : t("wg_free")}</dd></div>
            <div className="wg-grand"><dt>{t("wg_toPay")}</dt><dd>{rupees(total)}</dd></div>
          </dl>
          {discount ? <p className="wg-saved">{t("wg_youSave", { amount: rupees(discount) })}</p> : null}
          <p className="wg-paynote">{t("wg_payNote")}</p>
        </section>

        {error ? <p className="wg-error" role="alert">{error}</p> : null}
        <div className="wg-placebar">
          <button type="submit" className="wg-btn wg-btn-primary wg-btn-block" disabled={!ready || busy}>
            {busy ? t("wg_placing") : when === "later" ? t("wg_placeLater", { total: rupees(total) }) : t("wg_place", { total: rupees(total) })}
          </button>
          {!ready ? <p className="wg-fine wg-center">{t("wg_placeHint")}</p> : null}
        </div>
      </form>
    </WgFrame>
  );
}
