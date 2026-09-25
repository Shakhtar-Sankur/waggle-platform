import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { Check, Copy, Share2, ShoppingBag, Trash2, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useT } from "../i18n";
import { DietMark } from "../business/BusinessCatalog";
import { BusinessService, type GroupCart, type PublicItem, type PublicShop } from "../business/BusinessService";
import { hasOptions } from "./cart";
import { Checkout } from "./Checkout";
import { groupMemory, rememberGroup, rememberOrder, rupees, webLink, WgFrame } from "./common";
import { ItemSheet, Price } from "./ItemParts";

/**
 * One basket for a group of friends. Everyone opens the same link, adds what
 * they want under their own name, and sees their share. Only the phone that
 * started it can place the order; after that the link shows the order itself.
 */
export function GroupPage() {
  const t = useT();
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const memory = groupMemory(token);
  const [cart, setCart] = useState<GroupCart | null | undefined>(undefined);
  const [shop, setShop] = useState<PublicShop | null>(null);
  const [member, setMember] = useState(memory.member ?? "");
  const [nameSet, setNameSet] = useState(Boolean(memory.member));
  const [open, setOpen] = useState<PublicItem | null>(null);
  const [checkout, setCheckout] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const host = Boolean(memory.hostKey);

  const load = () => BusinessService.groupCart(token).then(setCart).catch(() => setCart((c) => c ?? null));
  useEffect(() => {
    void load();
    // Friends add from their own phones: keep the basket in step.
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (cart?.businessId && !shop) void BusinessService.publicShop(cart.businessId).then(setShop);
  }, [cart?.businessId]); // eslint-disable-line react-hooks/exhaustive-deps

  const members = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of cart?.lines ?? []) map.set(l.member, (map.get(l.member) ?? 0) + l.unitRupees * l.qty);
    return [...map.entries()];
  }, [cart]);

  if (cart === undefined) return <WgFrame><p className="wg-loading">{t("biz_loading")}</p></WgFrame>;
  // An open basket past its three hours takes no more food: say so rather than fail on "Add".
  const expired = cart ? cart.status === "open" && new Date(cart.expiresAt).getTime() < Date.now() : false;
  if (cart === null || expired) {
    return (
      <WgFrame>
        <main className="wg-page">
          <section className="wg-card wg-empty">
            <Users size={28} />
            <h2>{t("wg_groupMissing")}</h2>
            <p>{t("wg_groupMissingSub")}</p>
            {cart ? <Link className="wg-btn wg-btn-primary" to={`/shop/${cart.businessId}`}>{t("wg_groupStartNew", { shop: cart.shop })}</Link> : null}
          </section>
        </main>
      </WgFrame>
    );
  }
  if (cart.status === "ordered" && cart.orderToken) {
    return (
      <WgFrame>
        <main className="wg-page">
          <section className="wg-card wg-empty">
            <Check size={30} />
            <h2>{t("wg_groupPlaced", { host: cart.host })}</h2>
            <p>{t("wg_groupPlacedSub")}</p>
            <Link className="wg-btn wg-btn-primary" to={`/order/${cart.orderToken}`}>{t("wg_followOrder")}</Link>
          </section>
        </main>
      </WgFrame>
    );
  }
  if (checkout && shop && memory.hostKey) {
    return (
      <Checkout
        shop={shop}
        lines={[]}
        group={{ token, hostKey: memory.hostKey, lines: cart.lines }}
        onBack={() => setCheckout(false)}
        onPlaced={(orderToken, code) => {
          rememberOrder({ token: orderToken, code, shop: shop.name, shopId: shop.id, at: new Date().toISOString() });
          navigate(`/order/${orderToken}`, { replace: true });
        }}
      />
    );
  }

  const link = webLink(`/group/${token}`);
  async function share() {
    if (!link) return;
    const text = t("wg_groupShareText", { shop: cart!.shop, host: cart!.host });
    if (Capacitor.isNativePlatform()) await Share.share({ title: cart!.shop, text, url: link });
    else if (navigator.share) await navigator.share({ title: cart!.shop, text, url: link }).catch(() => undefined);
    else { await navigator.clipboard.writeText(link); setCopied(true); }
  }
  async function add(itemId: string, selection: [number, number][], qty: number) {
    setError("");
    try {
      await BusinessService.groupAdd(token, member, itemId, qty, selection);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("biz_errGeneric"));
    }
  }
  const total = (cart.lines ?? []).reduce((s, l) => s + l.unitRupees * l.qty, 0);
  const deliveryShare = members.length ? cart.deliveryRupees / members.length : 0;

  return (
    <WgFrame>
      <main className="wg-page">
        <section className="wg-group-hero">
          <Users size={22} />
          <div>
            <h1>{t("wg_groupTitle", { shop: cart.shop })}</h1>
            <p>{t("wg_groupBy", { host: cart.host, time: new Date(cart.expiresAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) })}</p>
          </div>
        </section>
        <section className="wg-card wg-group-share">
          <p className="wg-fine">{t(link ? "wg_groupShareHelp" : "wg_groupShareSoon")}</p>
          {link ? <div className="wg-after-actions">
            <button type="button" className="wg-btn wg-btn-primary" onClick={() => void share()}><Share2 size={16} /> {t("wg_groupShare")}</button>
            <button type="button" className="wg-btn wg-btn-soft" onClick={() => void navigator.clipboard.writeText(link).then(() => setCopied(true))}>
              {copied ? <Check size={16} /> : <Copy size={16} />} {t(copied ? "bx_copied" : "bx_copy")}
            </button>
          </div> : null}
        </section>

        {!nameSet ? (
          <section className="wg-card">
            <h2 className="wg-h2">{t("wg_groupYourName")}</h2>
            <div className="wg-coupon-row">
              <input className="wg-input" value={member} onChange={(e) => setMember(e.target.value)} placeholder={t("wg_yourNamePh")} maxLength={30} />
              <button type="button" className="wg-btn wg-btn-primary" disabled={!member.trim()} onClick={() => { rememberGroup(token, { member: member.trim() }); setNameSet(true); }}>{t("wg_groupJoin")}</button>
            </div>
          </section>
        ) : null}

        <section className="wg-card">
          <div className="wg-h2-row"><h2 className="wg-h2"><ShoppingBag size={17} /> {t("wg_groupBasket")}</h2><b>{rupees(total)}</b></div>
          {cart.lines.length === 0 ? <p className="wg-fine">{t("wg_groupEmpty")}</p> : (
            <ul className="wg-lines">
              {cart.lines.map((l) => (
                <li key={l.id}>
                  <span>
                    <strong><DietMark diet={l.diet} /> {l.name}</strong>
                    {l.options.length ? <small>{l.options.map((o) => o.choice).join(", ")}</small> : null}
                    <small className="wg-line-member">{l.member}</small>
                  </span>
                  <span className="wg-qty">× {l.qty}</span>
                  <b>{rupees(l.unitRupees * l.qty)}</b>
                  {l.member === member.trim() || host ? (
                    <button type="button" className="wg-icon" aria-label={t("biz_itemDelete")} onClick={() => void BusinessService.groupRemove(token, l.id).then(load)}><Trash2 size={15} /></button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {members.length ? (
            <div className="wg-split">
              <h3>{t("wg_splitTitle")}</h3>
              {members.map(([name, sum]) => (
                <div key={name}><span>{name}</span><b>{rupees(Math.round((sum + deliveryShare) * 100) / 100)}</b></div>
              ))}
              <p className="wg-fine">{t("wg_splitNote")}</p>
            </div>
          ) : null}
          {error ? <p className="wg-error">{error}</p> : null}
          {host ? (
            <button type="button" className="wg-btn wg-btn-primary wg-btn-block" disabled={!cart.lines.length || !shop} onClick={() => setCheckout(true)}>{t("wg_groupCheckoutBtn")}</button>
          ) : <p className="wg-fine wg-center">{t("wg_groupWaitHost", { host: cart.host })}</p>}
        </section>

        {nameSet && shop ? (
          <section className="wg-section">
            <h2 className="wg-section-title">{t("wg_groupAddTitle", { name: member })}</h2>
            <ul className="wg-items">
              {shop.items.filter((i) => !i.soldOut).map((item) => (
                <li key={item.id} className="wg-item">
                  <button type="button" className="wg-item-text" onClick={() => setOpen(item)}>
                    <strong><DietMark diet={item.diet} /> {item.name}</strong>
                    <Price item={item} />
                    {item.quantityLabel ? <span className="wg-item-meta">{item.quantityLabel}</span> : null}
                  </button>
                  <div className="wg-item-side">
                    {item.photoUrl ? <img src={item.photoUrl} alt="" loading="lazy" /> : null}
                    <button type="button" className="wg-add" onClick={() => (hasOptions(item) ? setOpen(item) : void add(item.id, [], 1))}>{t("wg_add")}</button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
      {open && shop ? (
        <ItemSheet item={open} shop={shop} inBasket={0} onAdd={(sel, qty) => void add(open.id, sel, qty)} onClose={() => setOpen(null)} />
      ) : null}
    </WgFrame>
  );
}

