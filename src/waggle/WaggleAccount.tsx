import { Briefcase, ChevronRight, Home, LogOut, MapPin, Plus, ShoppingBag, Trash2, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useT, type TKey } from "../i18n";
import { useAuthStore } from "../stores/useAuthStore";
import { BusinessService, type OrderStatus } from "../business/BusinessService";
import { MapPicker, type LatLng } from "../business/MapPicker";
import { dayAndTime, recentOrders, rupees, WgFrame } from "./common";
import { LABEL_KEY } from "./LocationSheet";
import { WaggleService, type SavedAddress } from "./WaggleService";

const STATUS: Record<OrderStatus, TKey> = {
  placed: "wg_stWaiting", accepted: "wg_stPreparing", dispatched: "wg_stOnTheWay", delivered: "wg_stDelivered", rejected: "wg_stDeclined", cancelled: "wg_stCancelled",
};

interface Row { token: string; code: string; shop: string; at: string; status?: OrderStatus; total?: number }

/** Orders from the account and from this phone, each with where it is now. */
export function OrdersPage() {
  const t = useT();
  const user = useAuthStore((s) => s.user);
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const local: Row[] = recentOrders().map((o) => ({ token: o.token, code: o.code, shop: o.shop, at: o.at }));
      const mine: Row[] = user
        ? (await WaggleService.myOrders().catch(() => [])).map((o) => ({ token: o.token, code: o.code, shop: o.shop, at: o.createdAt, status: o.status, total: o.totalRupees }))
        : [];
      const all = [...mine, ...local.filter((l) => !mine.some((m) => m.token === l.token))];
      // Orders from this phone only: ask where each one is now.
      const filled = await Promise.all(all.map(async (r) => {
        if (r.status) return r;
        const o = await BusinessService.trackOrder(r.token).catch(() => null);
        return o ? { ...r, status: o.status, total: o.totalRupees } : r;
      }));
      if (live) setRows(filled.sort((a, b) => b.at.localeCompare(a.at)));
    })();
    return () => { live = false; };
  }, [user]);

  return (
    <WgFrame nav>
      <main className="wg-page">
        <h1 className="wg-title">{t("wg_homeTitle")}</h1>
        {rows === null ? <p className="wg-loading">{t("biz_loading")}</p> : rows.length === 0 ? (
          <section className="wg-card wg-empty"><ShoppingBag size={28} /><h2>{t("wg_homeEmpty")}</h2><p>{t("wg_homeEmptySub")}</p></section>
        ) : (
          <section className="wg-card wg-orders">
            {rows.map((o) => (
              <Link key={o.token} to={`/order/${o.token}`}>
                <span className="wg-shop-logo wg-shop-logo-sm" aria-hidden>{o.shop.slice(0, 1)}</span>
                <span><strong>{o.shop}</strong><small>#{o.code} · {dayAndTime(o.at)}</small></span>
                <span className="wg-orders-right">
                  {o.status ? <em className={`wg-st wg-st-${o.status}`}>{t(STATUS[o.status])}</em> : null}
                  {o.total != null ? <b>{rupees(o.total)}</b> : null}
                </span>
                <ChevronRight size={18} />
              </Link>
            ))}
          </section>
        )}
        {!user ? <p className="wg-fine wg-center">{t("wg_signInForOrders")} <Link to="/auth">{t("wg_signIn")}</Link></p> : null}
      </main>
    </WgFrame>
  );
}

const ICON = { home: <Home size={16} />, work: <Briefcase size={16} />, other: <MapPin size={16} /> };

export function AccountPage() {
  const t = useT();
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [editing, setEditing] = useState<Partial<SavedAddress> | null>(null);
  const [error, setError] = useState("");

  const load = () => void WaggleService.addresses().then(setAddresses).catch(() => undefined);
  useEffect(() => { if (user) load(); }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!user) {
    return (
      <WgFrame nav>
        <main className="wg-page">
          <section className="wg-card wg-empty">
            <UserRound size={30} />
            <h2>{t("wg_accountTitle")}</h2>
            <p>{t("wg_accountSub")}</p>
            <Link className="wg-btn wg-btn-primary" to="/auth">{t("wg_signIn")}</Link>
          </section>
          <p className="wg-fine wg-center">{t("wg_guestNote")}</p>
        </main>
      </WgFrame>
    );
  }

  async function save() {
    if (!editing?.label || !editing.area || !editing.address || editing.lat == null || editing.lng == null) {
      setError(t("wg_addressErr"));
      return;
    }
    try {
      await WaggleService.saveAddress(editing as SavedAddress);
      setEditing(null);
      setError("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("biz_errGeneric"));
    }
  }

  return (
    <WgFrame nav>
      <main className="wg-page">
        <section className="wg-card wg-me">
          <span className="wg-avatar wg-avatar-indigo">{(user.fullName || "W").slice(0, 1).toUpperCase()}</span>
          <div><strong>{user.fullName}</strong><span>{user.phone}</span></div>
        </section>

        <section className="wg-card">
          <div className="wg-h2-row">
            <h2 className="wg-h2">{t("wg_savedPlaces")}</h2>
            {!editing ? <button type="button" className="wg-link" onClick={() => setEditing({ label: "home" })}><Plus size={15} /> {t("wg_addPlace")}</button> : null}
          </div>
          {addresses.length === 0 && !editing ? <p className="wg-fine">{t("wg_noPlaces")}</p> : null}
          {addresses.map((a) => (
            <div key={a.id} className="wg-place">
              {ICON[a.label]}
              <span><strong>{t(LABEL_KEY[a.label])} · {a.area}</strong><small>{a.address}</small></span>
              <button type="button" className="wg-link" onClick={() => setEditing(a)}>{t("biz_itemEdit")}</button>
              <button type="button" className="wg-icon" aria-label={t("biz_itemDelete")} onClick={() => void WaggleService.removeAddress(a.id).then(load)}><Trash2 size={15} /></button>
            </div>
          ))}
          {editing ? (
            <div className="wg-place-edit">
              <div className="wg-chips">
                {(["home", "work", "other"] as const).map((l) => (
                  <button key={l} type="button" className={editing.label === l ? "is-on" : ""} onClick={() => setEditing({ ...editing, label: l })}>{t(LABEL_KEY[l])}</button>
                ))}
              </div>
              <MapPicker value={editing.lat != null && editing.lng != null ? { lat: editing.lat, lng: editing.lng } : null}
                onChange={(p: LatLng) => setEditing({ ...editing, lat: p.lat, lng: p.lng })} height={200} />
              <input className="wg-input" value={editing.area ?? ""} onChange={(e) => setEditing({ ...editing, area: e.target.value })} placeholder={t("wg_area")} maxLength={60} />
              <input className="wg-input" value={editing.address ?? ""} onChange={(e) => setEditing({ ...editing, address: e.target.value })} placeholder={t("wg_addressPh")} maxLength={200} />
              {error ? <p className="wg-error">{error}</p> : null}
              <div className="wg-after-actions">
                <button type="button" className="wg-btn wg-btn-primary" onClick={() => void save()}>{t("biz_save")}</button>
                <button type="button" className="wg-btn wg-btn-ghost" onClick={() => { setEditing(null); setError(""); }}>{t("wg_cancelNo")}</button>
              </div>
            </div>
          ) : null}
        </section>

        <button type="button" className="wg-btn wg-btn-soft" onClick={() => void signOut()}><LogOut size={16} /> {t("wg_signOut")}</button>
        <p className="wg-fine wg-center">{t("wg_oneAccount")}</p>
      </main>
    </WgFrame>
  );
}
