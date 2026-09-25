import { BadgePercent, Pause, Play } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "../components/ui/Button";
import { useT } from "../i18n";
import { BusinessTop, rupees } from "./BusinessScreens";
import type { Business, Coupon } from "./BusinessService";

type Draft = {
  id?: string; code: string; title: string; kind: "percent" | "flat"; value: string; minOrder: string; maxDiscount: string;
  perPhone: string; usageLimit: string; firstOrderOnly: boolean; endsOn: string; active: boolean;
};
const EMPTY: Draft = { code: "", title: "", kind: "percent", value: "10", minOrder: "", maxDiscount: "", perPhone: "1", usageLimit: "", firstOrderOnly: false, endsOn: "", active: true };

/** A shop's own offers. The shop pays for them; Waggle checks who may use them at checkout. */
export function OffersScreen({
  business,
  coupons,
  onSave,
  nav,
}: {
  business: Business;
  coupons: Coupon[];
  onSave: (c: Omit<Coupon, "id" | "startsAt"> & { id?: string }) => Promise<void>;
  nav?: ReactNode;
}) {
  const t = useT();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const value = Number(draft.value || 0);

  const summary = (c: { kind: "percent" | "flat"; value: number; minOrderPaise: number; maxDiscountPaise: number | null; firstOrderOnly: boolean }) =>
    [
      c.kind === "percent" ? t("bx_offPercent", { n: String(c.value) }) : t("bx_offFlat", { amount: rupees(c.value / 100) }),
      c.maxDiscountPaise ? t("bx_offUpTo", { amount: rupees(c.maxDiscountPaise / 100) }) : null,
      c.minOrderPaise ? t("bx_offMin", { amount: rupees(c.minOrderPaise / 100) }) : null,
      c.firstOrderOnly ? t("bx_offFirst") : null,
    ].filter(Boolean).join(" · ");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!/^[A-Z0-9]{3,15}$/.test(draft.code) || draft.title.trim().length < 3 || !(value > 0) || (draft.kind === "percent" && value > 90)) {
      setError(t("bx_offErr"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave({
        id: draft.id,
        code: draft.code,
        title: draft.title,
        kind: draft.kind,
        value: draft.kind === "percent" ? Math.round(value) : Math.round(value * 100),
        minOrderPaise: Math.round(Number(draft.minOrder || 0) * 100),
        maxDiscountPaise: draft.kind === "percent" && draft.maxDiscount ? Math.round(Number(draft.maxDiscount) * 100) : null,
        perPhoneLimit: Math.max(1, Number(draft.perPhone || 1)),
        usageLimit: draft.usageLimit ? Number(draft.usageLimit) : null,
        firstOrderOnly: draft.firstOrderOnly,
        endsAt: draft.endsOn ? new Date(`${draft.endsOn}T23:59:59`).toISOString() : null,
        active: draft.active,
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
        <div className="biz-top-business"><h1>{t("bx_offersTitle")}</h1><p>{t("bx_offersSub")}</p></div>
      </BusinessTop>
      {nav}
      <div className="biz-columns">
        <aside className="biz-side biz-side-always">
          <form className="biz-body" onSubmit={submit}>
            <section className="biz-card">
              <div className="biz-card-head"><strong>{t(draft.id ? "bx_offEdit" : "bx_offNew")}</strong></div>
              <div className="biz-row">
                <label className="biz-field"><span>{t("bx_offCode")}</span>
                  <input value={draft.code} onChange={(e) => set({ code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} placeholder="DOSA20" maxLength={15} disabled={Boolean(draft.id)} />
                </label>
                <div className="biz-field">
                  <span>{t("bx_offKind")}</span>
                  <div className="biz-chips">
                    <button type="button" className={`biz-chip${draft.kind === "percent" ? " is-on" : ""}`} onClick={() => set({ kind: "percent" })}>%</button>
                    <button type="button" className={`biz-chip${draft.kind === "flat" ? " is-on" : ""}`} onClick={() => set({ kind: "flat" })}>₹</button>
                  </div>
                </div>
              </div>
              <label className="biz-field"><span>{t("bx_offTitle")}</span>
                <input value={draft.title} onChange={(e) => set({ title: e.target.value })} placeholder={t("bx_offTitlePh")} maxLength={60} />
              </label>
              <div className="biz-row">
                <label className="biz-field"><span>{t(draft.kind === "percent" ? "bx_offPercentLabel" : "bx_offFlatLabel")}</span>
                  <input value={draft.value} onChange={(e) => set({ value: e.target.value.replace(/[^\d.]/g, "") })} inputMode="decimal" />
                </label>
                {draft.kind === "percent" ? (
                  <label className="biz-field"><span>{t("bx_offCap")}</span>
                    <input value={draft.maxDiscount} onChange={(e) => set({ maxDiscount: e.target.value.replace(/[^\d.]/g, "") })} inputMode="decimal" placeholder={t("bx_offNoCap")} />
                  </label>
                ) : null}
              </div>
              <div className="biz-row">
                <label className="biz-field"><span>{t("bx_offMinLabel")}</span>
                  <input value={draft.minOrder} onChange={(e) => set({ minOrder: e.target.value.replace(/[^\d.]/g, "") })} inputMode="decimal" placeholder="0" />
                </label>
                <label className="biz-field"><span>{t("bx_offEnds")}</span>
                  <input type="date" value={draft.endsOn} onChange={(e) => set({ endsOn: e.target.value })} />
                </label>
              </div>
              <div className="biz-row">
                <label className="biz-field"><span>{t("bx_offPerPhone")}</span>
                  <input value={draft.perPhone} onChange={(e) => set({ perPhone: e.target.value.replace(/\D/g, "") })} inputMode="numeric" />
                </label>
                <label className="biz-field"><span>{t("bx_offTotal")}</span>
                  <input value={draft.usageLimit} onChange={(e) => set({ usageLimit: e.target.value.replace(/\D/g, "") })} inputMode="numeric" placeholder={t("bx_offNoLimit")} />
                </label>
              </div>
              <label className="biz-check"><input type="checkbox" checked={draft.firstOrderOnly} onChange={(e) => set({ firstOrderOnly: e.target.checked })} /> <span>{t("bx_offFirstLabel")}</span></label>
              <div className="biz-offer-preview">
                <BadgePercent size={18} />
                <span><strong>{draft.title || t("bx_offTitlePh")}</strong><small>{t("bx_offUse", { code: draft.code || "CODE" })} · {summary({
                  kind: draft.kind, value: draft.kind === "percent" ? value : value * 100, minOrderPaise: Number(draft.minOrder || 0) * 100,
                  maxDiscountPaise: draft.maxDiscount ? Number(draft.maxDiscount) * 100 : null, firstOrderOnly: draft.firstOrderOnly,
                })}</small></span>
              </div>
              <p className="biz-help">{t("bx_offWhoPays")}</p>
              {error ? <p className="biz-error" role="alert">{error}</p> : null}
              <div className="biz-decide">
                <Button type="submit" disabled={busy}>{t(draft.id ? "biz_save" : "bx_offCreate")}</Button>
                {draft.id ? <Button variant="ghost" onClick={() => setDraft(EMPTY)}>{t("biz_back")}</Button> : null}
              </div>
            </section>
          </form>
        </aside>
        <div className="biz-body">
          {coupons.length === 0 ? (
            <section className="biz-card"><div className="biz-empty"><BadgePercent size={22} /><p>{t("bx_offEmpty")}</p></div></section>
          ) : coupons.map((c) => (
            <section key={c.id} className={`biz-card biz-coupon${c.active ? "" : " is-off"}`}>
              <div className="biz-card-head">
                <strong><code>{c.code}</code> {c.title}</strong>
                <span className={`biz-status ${c.active ? "biz-status-approved" : "biz-status-paused"}`}>{t(c.active ? "bx_offLive" : "bx_offPaused")}</span>
              </div>
              <p className="biz-help">{summary(c)}{c.endsAt ? ` · ${t("bx_offUntil", { date: new Date(c.endsAt).toLocaleDateString() })}` : ""}</p>
              <div className="biz-decide">
                <Button variant="outline" size="sm" onClick={() => void onSave({ ...c, active: !c.active })}>
                  {c.active ? <><Pause size={14} /> {t("bx_adPause")}</> : <><Play size={14} /> {t("bx_adResume")}</>}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setDraft({
                  id: c.id, code: c.code, title: c.title, kind: c.kind, value: String(c.kind === "percent" ? c.value : c.value / 100),
                  minOrder: c.minOrderPaise ? String(c.minOrderPaise / 100) : "", maxDiscount: c.maxDiscountPaise ? String(c.maxDiscountPaise / 100) : "",
                  perPhone: String(c.perPhoneLimit), usageLimit: c.usageLimit ? String(c.usageLimit) : "", firstOrderOnly: c.firstOrderOnly,
                  endsOn: c.endsAt ? c.endsAt.slice(0, 10) : "", active: c.active,
                })}>{t("biz_itemEdit")}</Button>
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
