import { Check, Copy, KeyRound, Megaphone, Pause, Play, Trash2 } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "../components/ui/Button";
import { useT, type TKey } from "../i18n";
import { BusinessTop, rupees } from "./BusinessScreens";
import { PLANS, type AdCampaign, type AdStatus, type ApiKey, type Business, type CatalogItem } from "./BusinessService";

/* ------------------------------------------------------------------ ads */

const AD_STATUS: Record<AdStatus, TKey> = {
  pending: "bx_adPending",
  approved: "bx_adApproved",
  rejected: "bx_adRejected",
  paused: "bx_adPaused",
  ended: "bx_adEnded",
};

type AdDraft = { id?: string; name: string; headline: string; itemId: string; budget: string; startsOn: string; endsOn: string };
const today = () => new Date().toISOString().slice(0, 10);
const blankAd = (): AdDraft => ({ name: "", headline: "", itemId: "", budget: "300", startsOn: today(), endsOn: "" });

export function AdsScreen({
  business,
  campaigns,
  items,
  spent,
  onSave,
  onState,
  nav,
}: {
  business: Business;
  campaigns: AdCampaign[];
  items: CatalogItem[];
  spent: number;
  onSave: (c: { id?: string; name: string; headline: string; itemId: string | null; budgetRupees: number; startsOn: string; endsOn: string | null }) => Promise<void>;
  onState: (id: string, state: "paused" | "approved" | "ended") => Promise<void>;
  nav?: ReactNode;
}) {
  const t = useT();
  const credit = PLANS[business.plan].adCredit;
  const [draft, setDraft] = useState<AdDraft>(blankAd);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const item = items.find((i) => i.id === draft.itemId);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const budget = Number(draft.budget);
    if (draft.name.trim().length < 2 || draft.headline.trim().length < 3 || !Number.isFinite(budget) || budget < 50) {
      setError(t("bx_adErr"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave({ id: draft.id, name: draft.name, headline: draft.headline, itemId: draft.itemId || null, budgetRupees: budget, startsOn: draft.startsOn, endsOn: draft.endsOn || null });
      setDraft(blankAd());
    } catch (err) {
      setError(err instanceof Error ? err.message : t("biz_errGeneric"));
    } finally {
      setBusy(false);
    }
  }

  async function change(id: string, state: "paused" | "approved" | "ended") {
    setError("");
    try {
      await onState(id, state);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("biz_errGeneric"));
    }
  }

  return (
    <div className="biz-frame biz-frame-wide">
      <BusinessTop business={business}>
        <div className="biz-top-business"><h1>{t("bx_adsTitle")}</h1><p>{t("bx_adsSub")}</p></div>
      </BusinessTop>
      {nav}
      <div className="biz-columns">
        <aside className="biz-side biz-side-always">
          <form className="biz-body" onSubmit={submit}>
            <section className="biz-card">
              <div className="biz-card-head"><strong>{t(draft.id ? "bx_adEdit" : "bx_adNew")}</strong></div>
              <label className="biz-field"><span>{t("bx_adName")}</span>
                <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={t("bx_adNamePh")} maxLength={60} />
              </label>
              <label className="biz-field"><span>{t("bx_adHeadline")} <small className="biz-muted">{draft.headline.length}/60</small></span>
                <input value={draft.headline} onChange={(e) => setDraft({ ...draft, headline: e.target.value })} placeholder={t("bx_adHeadlinePh")} maxLength={60} />
              </label>
              <label className="biz-field"><span>{t("bx_adPromote")}</span>
                <select value={draft.itemId} onChange={(e) => setDraft({ ...draft, itemId: e.target.value })}>
                  <option value="">{t("bx_adWholeShop")}</option>
                  {items.filter((i) => i.available).map((i) => <option key={i.id} value={i.id}>{i.name} · {rupees(i.priceRupees)}</option>)}
                </select>
              </label>
              <div className="biz-row">
                <label className="biz-field"><span>{t("bx_adBudget")}</span>
                  <input value={draft.budget} onChange={(e) => setDraft({ ...draft, budget: e.target.value.replace(/[^\d]/g, "") })} inputMode="numeric" />
                </label>
                <label className="biz-field"><span>{t("bx_adStarts")}</span>
                  <input type="date" value={draft.startsOn} min={today()} onChange={(e) => setDraft({ ...draft, startsOn: e.target.value })} />
                </label>
              </div>
              <label className="biz-field"><span>{t("bx_adEnds")}</span>
                <input type="date" value={draft.endsOn} min={draft.startsOn} onChange={(e) => setDraft({ ...draft, endsOn: e.target.value })} />
              </label>
              <div className="biz-ad-preview" aria-label={t("bx_adPreview")}>
                <small>{t("bx_adSponsored")}</small>
                <strong>{draft.headline || t("bx_adHeadlinePh")}</strong>
                <span>{business.name}{item ? ` · ${item.name} · ${rupees(item.priceRupees)}` : ""}</span>
              </div>
              {error ? <p className="biz-error" role="alert">{error}</p> : null}
              <div className="biz-decide">
                <Button type="submit" disabled={busy}>{t(draft.id ? "bx_adSaveEdit" : "bx_adCreate")}</Button>
                {draft.id ? <Button variant="ghost" onClick={() => setDraft(blankAd())}>{t("biz_back")}</Button> : null}
              </div>
            </section>
          </form>
        </aside>
        <div className="biz-body">
          <section className="biz-card biz-credit">
            <div>
              <span>{t("bx_adCredit")}</span>
              <b>{rupees(Math.max(0, credit - spent))}</b>
              <small>{credit ? t("bx_adCreditOf", { credit: rupees(credit), spent: rupees(spent) }) : t("bx_adCreditNone")}</small>
            </div>
            <Megaphone size={28} />
          </section>
          <p className="biz-note">{t("bx_adsWhen")}</p>
          {campaigns.length === 0 ? (
            <section className="biz-card"><div className="biz-empty"><Megaphone size={22} /><p>{t("bx_adsEmpty")}</p></div></section>
          ) : campaigns.map((c) => (
            <section key={c.id} className="biz-card biz-ad">
              <div className="biz-card-head">
                <strong>{c.name}</strong>
                <span className={`biz-status biz-ad-${c.status}`}>{t(AD_STATUS[c.status])}</span>
              </div>
              <p className="biz-ad-headline">“{c.headline}”</p>
              <p className="biz-help">
                {t("bx_adLine", { budget: rupees(c.budgetRupees), from: c.startsOn, to: c.endsOn ?? t("bx_adNoEnd") })}
                {c.itemId ? ` · ${items.find((i) => i.id === c.itemId)?.name ?? ""}` : ` · ${t("bx_adWholeShop")}`}
              </p>
              {c.reviewNote ? <blockquote className="biz-note">{c.reviewNote}</blockquote> : null}
              {c.status !== "ended" ? (
                <div className="biz-decide">
                  {c.status === "approved" ? <Button variant="outline" size="sm" onClick={() => void change(c.id, "paused")}><Pause size={14} /> {t("bx_adPause")}</Button> : null}
                  {c.status === "paused" ? <Button variant="outline" size="sm" onClick={() => void change(c.id, "approved")}><Play size={14} /> {t("bx_adResume")}</Button> : null}
                  <Button variant="ghost" size="sm" onClick={() => setDraft({ id: c.id, name: c.name, headline: c.headline, itemId: c.itemId ?? "", budget: String(c.budgetRupees), startsOn: c.startsOn < today() ? today() : c.startsOn, endsOn: c.endsOn ?? "" })}>{t("biz_itemEdit")}</Button>
                  <Button variant="ghost" size="sm" onClick={() => void change(c.id, "ended")}>{t("bx_adEnd")}</Button>
                </div>
              ) : null}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ the delivery API */

const API_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, "") ?? "https://YOUR-PROJECT.supabase.co";
const PUBLIC_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "PUBLIC_KEY";

export function ApiScreen({
  business,
  keys,
  onCreate,
  onRevoke,
  nav,
}: {
  business: Business;
  keys: ApiKey[];
  onCreate: (name: string) => Promise<string>;
  onRevoke: (id: string) => Promise<void>;
  nav?: ReactNode;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const live = keys.filter((k) => !k.revokedAt);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      setFresh(await onCreate(name));
      setCopied(false);
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("biz_errGeneric"));
    } finally {
      setBusy(false);
    }
  }

  const sample = `curl -X POST '${API_URL}/rest/v1/rpc/api_create_delivery' \\
  -H 'apikey: ${PUBLIC_KEY.slice(0, 12)}…' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "p_key": "wgk_live_…",
    "p_dropoff_area": "Saheed Nagar",
    "p_dropoff_address": "Plot 12, near Ram Mandir",
    "p_dropoff_lat": 20.2893,
    "p_dropoff_lng": 85.8412,
    "p_note": "Call on arrival",
    "p_reference": "ORDER-1001"
  }'`;

  return (
    <div className="biz-frame biz-frame-wide">
      <BusinessTop business={business}>
        <div className="biz-top-business"><h1>{t("bx_apiTitle")}</h1><p>{t("bx_apiSub")}</p></div>
      </BusinessTop>
      {nav}
      <div className="biz-columns">
        <aside className="biz-side biz-side-always">
          <div className="biz-body">
            <form className="biz-card" onSubmit={create}>
              <div className="biz-card-head"><strong><KeyRound size={16} /> {t("bx_apiNew")}</strong></div>
              <label className="biz-field"><span>{t("bx_apiKeyName")}</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("bx_apiKeyNamePh")} maxLength={40} />
              </label>
              {error ? <p className="biz-error" role="alert">{error}</p> : null}
              <Button type="submit" disabled={busy || name.trim().length < 2 || live.length >= 5}>{t("bx_apiCreate")}</Button>
              <p className="biz-help">{t("bx_apiLimit")}</p>
            </form>
            {fresh ? (
              <section className="biz-card biz-fresh-key" role="alert">
                <strong>{t("bx_apiOnce")}</strong>
                <code>{fresh}</code>
                <Button size="sm" onClick={() => void navigator.clipboard.writeText(fresh).then(() => setCopied(true))}>
                  {copied ? <Check size={15} /> : <Copy size={15} />} {t(copied ? "bx_copied" : "bx_copy")}
                </Button>
              </section>
            ) : null}
            <section className="biz-card">
              <div className="biz-card-head"><strong>{t("bx_apiKeys")}</strong></div>
              {keys.length === 0 ? <p className="biz-help">{t("bx_apiNone")}</p> : (
                <ul className="biz-keys">
                  {keys.map((k) => (
                    <li key={k.id} className={k.revokedAt ? "is-revoked" : ""}>
                      <span>
                        <strong>{k.name}</strong>
                        <code>{k.prefix}…</code>
                        <small>{k.revokedAt ? t("bx_apiRevoked") : k.lastUsedAt ? t("bx_apiUsed", { when: new Date(k.lastUsedAt).toLocaleString() }) : t("bx_apiNeverUsed")}</small>
                      </span>
                      {!k.revokedAt ? <Button variant="ghost" size="sm" onClick={() => void onRevoke(k.id)} aria-label={t("bx_apiRevoke")}><Trash2 size={15} /></Button> : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </aside>
        <div className="biz-body">
          <section className="biz-card biz-docs-api">
            <div className="biz-card-head"><strong>{t("bx_apiDocs")}</strong></div>
            <p>{t("bx_apiDocsIntro")}</p>
            <h4>{t("bx_apiCreateTitle")}</h4>
            <pre>{sample}</pre>
            <p className="biz-help">{t("bx_apiCreateHelp")}</p>
            <h4>{t("bx_apiStatusTitle")}</h4>
            <pre>{`POST ${API_URL}/rest/v1/rpc/api_delivery_status
{ "p_key": "wgk_live_…", "p_id": "<delivery id>" }`}</pre>
            <h4>{t("bx_apiCancelTitle")}</h4>
            <pre>{`POST ${API_URL}/rest/v1/rpc/api_cancel_delivery
{ "p_key": "wgk_live_…", "p_id": "<delivery id>" }`}</pre>
            <h4>{t("bx_apiAnswer")}</h4>
            <pre>{`{ "id": "…", "status": "open | accepted | picked_up | completed | cancelled",
  "reference": "ORDER-1001", "distance_km": 3.4, "fare_rupees": 38, "fee_paise": 1000,
  "pickup_code": "4821", "delivery_code": "7390",
  "created_at": "…", "accepted_at": null, "picked_up_at": null, "delivered_at": null }`}</pre>
            <ul className="biz-help-list">
              <li>{t("bx_apiRule1")}</li>
              <li>{t("bx_apiRule2")}</li>
              <li>{t("bx_apiRule3")}</li>
              <li>{t("bx_apiRule4")}</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
