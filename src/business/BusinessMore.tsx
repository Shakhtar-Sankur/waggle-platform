import { BadgePercent, BarChart3, LifeBuoy, Building2, CalendarCheck, ChevronRight, ClipboardList, Code2, IdCard, IndianRupee, Megaphone, MoreHorizontal, Package, Receipt, ShieldCheck, ShoppingBag, Store, UserRound } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { useT, type TKey } from "../i18n";
import { BusinessTop, rupees } from "./BusinessScreens";
import { AdminNotices, AdminTickets } from "./AdminRiders";
import {
  stateName,
  type BillingRun,
  type Business,
  type QueueAd,
  type QueueBusiness,
  type QueuePayment,
  type QueueWorker,
} from "./BusinessService";

/* ------------------------------------------------------------------ navigation */

/** A bottom bar on a phone, tabs under the band on a computer. */
type NavItem = { to: string; label: TKey; icon: ReactNode; where: "both" | "desk" | "phone" };

export function BusinessNav({ admin, base = "", newOrders = 0 }: { admin?: boolean; base?: string; newOrders?: number }) {
  const t = useT();
  const items: NavItem[] = [
    { to: `${base}/`, label: "biz_navHome", icon: <ClipboardList size={20} />, where: "both" },
    { to: `${base}/orders`, label: "bx_navOrders", icon: <ShoppingBag size={20} />, where: "both" },
    { to: `${base}/catalog`, label: "biz_navCatalog", icon: <Package size={20} />, where: "both" },
    { to: `${base}/billing`, label: "biz_navBilling", icon: <Receipt size={20} />, where: "both" },
    { to: `${base}/offers`, label: "bx_navOffers", icon: <BadgePercent size={20} />, where: "desk" },
    { to: `${base}/reports`, label: "bx_navReports", icon: <BarChart3 size={20} />, where: "desk" },
    { to: `${base}/ads`, label: "bx_navAds", icon: <Megaphone size={20} />, where: "desk" },
    { to: `${base}/api`, label: "bx_navApi", icon: <Code2 size={20} />, where: "desk" },
    { to: `${base}/business`, label: "biz_navProfile", icon: <Store size={20} />, where: "desk" },
    { to: `${base}/more`, label: "bx_navMore", icon: <MoreHorizontal size={20} />, where: "phone" },
  ];
  if (admin) items.push({ to: `${base}/admin`, label: "biz_navAdmin", icon: <ShieldCheck size={20} />, where: "desk" });
  return (
    <nav className="biz-nav" aria-label="Waggle Business">
      {items.map((item) => (
        <NavLink key={item.to} to={item.to} end
          className={({ isActive }) => `biz-nav-item${isActive ? " is-on" : ""}${item.where === "desk" ? " biz-desk-only" : item.where === "phone" ? " biz-phone-only" : ""}`}>
          {item.icon}
          <span>{t(item.label)}</span>
          {item.label === "bx_navOrders" && newOrders ? <span className="biz-nav-dot">{newOrders}</span> : null}
        </NavLink>
      ))}
    </nav>
  );
}

/** A phone's way to the pages that do not fit in the bottom bar. */
export function MoreScreen({ business, admin, base = "", nav }: { business: Business; admin?: boolean; base?: string; nav?: ReactNode }) {
  const t = useT();
  const links: { to: string; label: TKey; sub: TKey; icon: ReactNode }[] = [
    { to: `${base}/offers`, label: "bx_navOffers", sub: "bx_moreOffers", icon: <BadgePercent size={20} /> },
    { to: `${base}/reports`, label: "bx_navReports", sub: "bx_moreReports", icon: <BarChart3 size={20} /> },
    { to: `${base}/ads`, label: "bx_navAds", sub: "bx_moreAds", icon: <Megaphone size={20} /> },
    { to: `${base}/api`, label: "bx_navApi", sub: "bx_moreApi", icon: <Code2 size={20} /> },
    { to: `${base}/business`, label: "biz_navProfile", sub: "bx_moreProfile", icon: <Store size={20} /> },
    { to: `${base}/verify`, label: "bx_kycTitle", sub: "bx_moreKyc", icon: <IdCard size={20} /> },
  ];
  if (admin) links.push({ to: `${base}/admin`, label: "biz_navAdmin", sub: "bx_moreAdmin", icon: <ShieldCheck size={20} /> });
  return (
    <div className="biz-frame">
      <BusinessTop business={business} />
      {nav}
      <div className="biz-body">
        <section className="biz-card biz-more">
          {links.map((l) => (
            <Link key={l.to} to={l.to}>
              <span className="biz-more-icon">{l.icon}</span>
              <span><strong>{t(l.label)}</strong><small>{t(l.sub)}</small></span>
              <ChevronRight size={18} />
            </Link>
          ))}
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ admin */

type AdminTab = "businesses" | "workers" | "payments" | "ads" | "month" | "hub" | "help";

export function AdminScreen({
  businesses,
  workers,
  payments,
  ads,
  onReviewBusiness,
  onReviewWorker,
  onReviewPayment,
  onReviewAd,
  onMonthEnd,
  runs = [],
  docUrl,
  nav,
  top,
}: {
  businesses: QueueBusiness[];
  workers: QueueWorker[];
  payments: QueuePayment[];
  ads: QueueAd[];
  onReviewBusiness: (id: string, decision: "verify" | "reject" | "suspend", note?: string, checks?: string[]) => Promise<void>;
  onReviewWorker: (id: string, decision: "verify" | "reject" | "suspend", note?: string) => Promise<void>;
  onReviewPayment: (id: string, decision: "confirm" | "reject", note?: string) => Promise<void>;
  onReviewAd: (id: string, approve: boolean, note?: string) => Promise<void>;
  onMonthEnd: (period: string) => Promise<{ invoices: number; plan_charges: number }>;
  /** Past month ends, newest first. */
  runs?: BillingRun[];
  docUrl: (path: string, bucket?: "worker-docs" | "business-docs") => Promise<string | null>;
  nav?: ReactNode;
  top?: ReactNode;
}) {
  const t = useT();
  const [tab, setTab] = useState<AdminTab>("businesses");
  const waitingB = businesses.filter((b) => b.status === "pending").length;
  const waitingW = workers.filter((w) => w.status === "pending").length;
  const waitingP = payments.filter((p) => p.status === "submitted").length;
  const waitingA = ads.filter((a) => a.status === "pending").length;
  return (
    <div className="biz-frame biz-frame-wide">
      {top ?? (
        <BusinessTop>
          <div className="biz-top-business"><h1>{t("biz_adminTitle")}</h1><p>{t("biz_adminSub")}</p></div>
        </BusinessTop>
      )}
      {nav}
      <div className="biz-body">
        <div className="biz-tabs" role="tablist">
          <button role="tab" aria-selected={tab === "businesses"} className={tab === "businesses" ? "is-on" : ""} onClick={() => setTab("businesses")}>
            <Building2 size={16} /> {t("biz_adminBusinesses")} {waitingB ? <span className="biz-count">{waitingB}</span> : null}
          </button>
          <button role="tab" aria-selected={tab === "workers"} className={tab === "workers" ? "is-on" : ""} onClick={() => setTab("workers")}>
            <UserRound size={16} /> {t("biz_adminWorkers")} {waitingW ? <span className="biz-count">{waitingW}</span> : null}
          </button>
          <button role="tab" aria-selected={tab === "payments"} className={tab === "payments" ? "is-on" : ""} onClick={() => setTab("payments")}>
            <IndianRupee size={16} /> {t("bx_adminPayments")} {waitingP ? <span className="biz-count">{waitingP}</span> : null}
          </button>
          <button role="tab" aria-selected={tab === "ads"} className={tab === "ads" ? "is-on" : ""} onClick={() => setTab("ads")}>
            <Megaphone size={16} /> {t("bx_navAds")} {waitingA ? <span className="biz-count">{waitingA}</span> : null}
          </button>
          <button role="tab" aria-selected={tab === "month"} className={tab === "month" ? "is-on" : ""} onClick={() => setTab("month")}>
            <CalendarCheck size={16} /> {t("bx_adminMonth")}
          </button>
          <button role="tab" aria-selected={tab === "hub"} className={tab === "hub" ? "is-on" : ""} onClick={() => setTab("hub")}>
            <Megaphone size={16} /> {t("gg_hubTab")}
          </button>
          <button role="tab" aria-selected={tab === "help"} className={tab === "help" ? "is-on" : ""} onClick={() => setTab("help")}>
            <LifeBuoy size={16} /> {t("gg_hubHelp")}
          </button>
        </div>
        {tab === "payments" ? (
          payments.length === 0 ? <section className="biz-card"><p className="biz-help">{t("biz_adminEmpty")}</p></section>
            : payments.map((p) => (
              <DecisionCard key={p.id} status={p.status} title={`${p.businessName} · ${rupees(p.amountRupees)}`} note={p.reviewNote}
                facts={[["UTR", p.utr], [t("bx_adminInvoice"), p.invoiceNumber ?? "—"], [t("bx_adminDue"), rupees(p.dueRupees)], [t("bx_adminWhen"), new Date(p.createdAt).toLocaleString()]]}
                open={p.status === "submitted"} yes={t("bx_adminConfirm")} no={t("biz_adminReject")} help={t("bx_adminPayHelp")}
                onDecide={(ok, note) => onReviewPayment(p.id, ok ? "confirm" : "reject", note)} />
            ))
        ) : tab === "ads" ? (
          ads.length === 0 ? <section className="biz-card"><p className="biz-help">{t("biz_adminEmpty")}</p></section>
            : ads.map((a) => (
              <DecisionCard key={a.id} status={a.status} title={`${a.businessName} · ${a.name}`} note={a.reviewNote}
                facts={[[t("bx_adHeadline"), a.headline], [t("bx_adPromote"), a.itemName ?? t("bx_adWholeShop")], [t("bx_adBudget"), rupees(a.budgetRupees)], [t("bx_adStarts"), `${a.startsOn}${a.endsOn ? ` → ${a.endsOn}` : ""}`]]}
                open={a.status === "pending"} yes={t("bx_adminApprove")} no={t("biz_adminReject")} help={t("bx_adminAdHelp")}
                onDecide={(ok, note) => onReviewAd(a.id, ok, note)} />
            ))
        ) : tab === "month" ? (
          <MonthEndCard onMonthEnd={onMonthEnd} runs={runs} />
        ) : tab === "hub" ? (
          <AdminNotices />
        ) : tab === "help" ? (
          <AdminTickets />
        ) : null}
        {tab === "businesses" ? (
          businesses.length === 0 ? <section className="biz-card"><p className="biz-help">{t("biz_adminEmpty")}</p></section>
            : businesses.map((b) => (
              <ReviewCard key={b.id} status={b.status} title={b.name} onDecide={(d, note, checks) => onReviewBusiness(b.id, d, note, checks)}
                note={b.reviewNote} requiredChecks={b.requiredChecks}
                facts={[
                  [t("biz_kind"), t(`bx_kind_${b.kind}` as TKey)],
                  [t("biz_address"), `${b.address}${b.stateCode ? ` · ${stateName(b.stateCode)}` : ""}`],
                  [t("biz_phone"), b.phone ?? "—"],
                  [t("bx_entity"), b.entityType ? t(`bx_ent_${b.entityType === "private_ltd" ? "private" : b.entityType === "public_ltd" ? "public" : b.entityType}` as TKey) : "—"],
                  [t("bx_adminOwner"), `${b.ownerName ?? "—"} · PAN ${b.pan ?? "—"} · Aadhaar ••••${b.aadhaarLast4 ?? "—"}`],
                  ["GSTIN", b.gstin ?? "—"],
                  ["GST", b.gstin ? t("bx_adminGstRegistered") : b.gstExemptDeclaredAt ? t("bx_adminGstDeclared", { when: new Date(b.gstExemptDeclaredAt).toLocaleDateString() }) : "—"],
                  [t("bx_proofTitle"), b.proofType ? `${t(`bx_proof_${b.proofType === "trade_licence" ? "trade" : b.proofType}` as TKey)} · ${b.proofNumber ?? "—"}` : "—"],
                  ...(b.fssai || b.fssaiExpiresOn ? [["FSSAI", `${b.fssai ?? "—"} · ${t("bx_validTill")} ${b.fssaiExpiresOn ?? "—"}`] as [string, string]] : []),
                  ...(b.kind === "pharmacy" ? [[t("bx_drug"), `${b.drugLicence ?? "—"} · ${t("bx_validTill")} ${b.drugLicenceExpiresOn ?? "—"}`] as [string, string]] : []),
                  ...(b.udyam ? [["Udyam", b.udyam] as [string, string]] : []),
                  [t("bx_kycPayout"), b.payoutMethod === "bank" ? `${b.bankAccountName ?? ""} · A/c ${b.bankAccountNumber ?? "—"} · ${b.bankIfsc ?? ""}` : b.payoutUpi ?? "—"],
                  [t("bx_adminAccount"), `${b.profileName ?? "—"} · ${b.profilePhone ?? "—"}`],
                ]}
                extra={
                  <>
                    {b.missing.length ? <p className="biz-error">{t("bx_adminMissing", { list: b.missing.join(", ") })}</p> : null}
                    {!b.licenceOk ? <p className="biz-error">{t("bx_adminLicenceLapsed")}</p> : null}
                    {b.lastReview ? <p className="biz-help">{t("bx_adminLastReview", { decision: b.lastReview.decision, by: b.lastReview.by ?? "—", when: new Date(b.lastReview.at).toLocaleString(), count: String(b.lastReview.checks.length) })}</p> : null}
                    <DocLinks docUrl={(path) => docUrl(path, "business-docs")} paths={(Object.entries(b.docs) as [string, string][]).map(([k, v]) => [t(`bx_doc_${k}` as TKey), v])} />
                    <a className="biz-link" href={`https://www.openstreetmap.org/?mlat=${b.lat}&mlon=${b.lng}#map=18/${b.lat}/${b.lng}`} target="_blank" rel="noreferrer">{t("biz_adminMap")}</a>
                  </>
                } />
            ))
        ) : tab !== "workers" ? null
          : workers.length === 0 ? <section className="biz-card"><p className="biz-help">{t("biz_adminEmpty")}</p></section>
          : workers.map((w) => (
            <ReviewCard key={w.userId} status={w.status} title={`${w.legalName}${w.profileName && w.profileName !== w.legalName ? ` (${w.profileName})` : ""}`}
              note={w.reviewNote} onDecide={(d, note) => onReviewWorker(w.userId, d, note)}
              facts={[
                [t("biz_phone"), w.profilePhone ?? "—"],
                [t("biz_adminVehicle"), `${w.vehicle}${w.vehicleNumber ? ` · ${w.vehicleNumber}` : ""}`],
                [t("biz_adminLicence"), w.licenceNumber ?? "—"],
                [t("biz_adminUpi"), w.upiId],
                [t("biz_adminIdType"), w.idType],
              ]}
              extra={<DocLinks docUrl={(path) => docUrl(path, "worker-docs")} paths={[
                [t("biz_adminIdPhoto"), w.idPhotoPath], [t("biz_adminSelfie"), w.selfiePath],
                ...(w.licencePhotoPath ? [[t("bx_adminLicencePhoto"), w.licencePhotoPath] as [string, string]] : []),
                ...(w.rcPhotoPath ? [[t("bx_adminRcPhoto"), w.rcPhotoPath] as [string, string]] : []),
              ]} />} />
          ))}
      </div>
    </div>
  );
}

function DocLinks({ paths, docUrl }: { paths: [string, string][]; docUrl: (path: string) => Promise<string | null> }) {
  const [urls, setUrls] = useState<(string | null)[]>([]);
  useEffect(() => {
    let live = true;
    void Promise.all(paths.map(([, p]) => docUrl(p))).then((u) => live && setUrls(u));
    return () => { live = false; };
  }, [paths.map((p) => p[1]).join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="biz-docs">
      {paths.map(([label], i) => (
        urls[i] ? <a key={label} href={urls[i]!} target="_blank" rel="noreferrer"><img src={urls[i]!} alt={label} /><span>{label}</span></a>
          : <span key={label} className="biz-doc-missing"><IdCard size={18} /> {label}</span>
      ))}
    </div>
  );
}

function ReviewCard({
  title,
  status,
  facts,
  extra,
  note,
  requiredChecks,
  onDecide,
}: {
  title: string;
  status: string;
  facts: [string, string][];
  extra?: ReactNode;
  note: string | null;
  /** Checks the reviewer must tick before Verify works (businesses). */
  requiredChecks?: string[];
  onDecide: (decision: "verify" | "reject" | "suspend", note?: string, checks?: string[]) => Promise<void>;
}) {
  const t = useT();
  const [reason, setReason] = useState("");
  const [ticked, setTicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const allTicked = !requiredChecks || requiredChecks.every((c) => ticked.includes(c));
  async function decide(decision: "verify" | "reject" | "suspend") {
    setBusy(true);
    setError("");
    try {
      await onDecide(decision, reason || undefined, ticked);
      setReason("");
      setTicked([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("biz_errGeneric"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={`biz-card biz-review is-${status}`}>
      <div className="biz-card-head">
        <strong>{title}</strong>
        <span className={`biz-status biz-status-${status}`}>{status}</span>
      </div>
      <div className="biz-facts">{facts.map(([k, v]) => <div key={k}><span>{k}</span><strong>{v}</strong></div>)}</div>
      {extra}
      {note ? <blockquote className="biz-note">{note}</blockquote> : null}
      {requiredChecks && status !== "verified" ? (
        <fieldset className="biz-ticks">
          <legend>{t("bx_adminTicks")}</legend>
          {requiredChecks.map((c) => (
            <label key={c}>
              <input type="checkbox" checked={ticked.includes(c)}
                onChange={(e) => setTicked((list) => (e.target.checked ? [...list, c] : list.filter((x) => x !== c)))} />
              <span>{t(`bx_check_${c}` as TKey)}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      <label className="biz-field"><span>{t("biz_adminReason")}</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("biz_adminReasonPh")} maxLength={300} />
      </label>
      {error ? <p className="biz-error" role="alert">{error}</p> : null}
      <div className="biz-decide">
        {status !== "verified" ? <Button disabled={busy || !allTicked} onClick={() => void decide("verify")}>{t("biz_adminVerify")}</Button> : null}
        {status === "pending" ? <Button variant="outline" disabled={busy} onClick={() => void decide("reject")}>{t("biz_adminReject")}</Button> : null}
        {status !== "suspended" ? <Button variant="ghost" disabled={busy} onClick={() => void decide("suspend")}>{t("biz_adminSuspend")}</Button> : null}
      </div>
    </section>
  );
}

function DecisionCard({
  title,
  status,
  facts,
  note,
  open,
  yes,
  no,
  help,
  onDecide,
}: {
  title: string;
  status: string;
  facts: [string, string][];
  note: string | null;
  open: boolean;
  yes: string;
  no: string;
  help: string;
  onDecide: (ok: boolean, note?: string) => Promise<void>;
}) {
  const t = useT();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function decide(ok: boolean) {
    setBusy(true);
    setError("");
    try {
      await onDecide(ok, reason || undefined);
      setReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("biz_errGeneric"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={`biz-card biz-review is-${status}`}>
      <div className="biz-card-head"><strong>{title}</strong><span className={`biz-status biz-status-${status}`}>{status}</span></div>
      <div className="biz-facts">{facts.map(([k, v]) => <div key={k}><span>{k}</span><strong>{v}</strong></div>)}</div>
      {note ? <blockquote className="biz-note">{note}</blockquote> : null}
      {open ? (
        <>
          <p className="biz-help">{help}</p>
          <label className="biz-field"><span>{t("biz_adminReason")}</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("biz_adminReasonPh")} maxLength={300} />
          </label>
          {error ? <p className="biz-error" role="alert">{error}</p> : null}
          <div className="biz-decide">
            <Button disabled={busy} onClick={() => void decide(true)}>{yes}</Button>
            <Button variant="outline" disabled={busy} onClick={() => void decide(false)}>{no}</Button>
          </div>
        </>
      ) : null}
    </section>
  );
}

function MonthEndCard({ onMonthEnd, runs }: { onMonthEnd: (period: string) => Promise<{ invoices: number; plan_charges: number }>; runs: BillingRun[] }) {
  const t = useT();
  const last = new Date();
  last.setDate(1);
  last.setMonth(last.getMonth() - 1);
  const period = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-01`;
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const [error, setError] = useState("");
  async function run() {
    setBusy(true);
    setError("");
    try {
      const r = await onMonthEnd(period);
      setDone(t("bx_adminMonthDone", { invoices: String(r.invoices), plans: String(r.plan_charges) }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("biz_errGeneric"));
    } finally {
      setBusy(false);
    }
  }
  const closed = runs.find((r) => r.period === period);
  const monthName = (p: string) => new Date(`${p}T00:00:00`).toLocaleDateString([], { month: "long", year: "numeric" });
  return (
    <>
      <section className="biz-card">
        <div className="biz-card-head"><strong>{t("bx_adminMonthTitle", { month: monthName(period) })}</strong></div>
        <p className="biz-ok"><CalendarCheck size={16} /> {t("bx_adminMonthAuto")}</p>
        <p className="biz-help">{t(closed ? "bx_adminMonthClosed" : "bx_adminMonthHelp", closed ? { when: new Date(closed.ranAt).toLocaleString() } : undefined)}</p>
        {done ? <p className="biz-ok" role="status">{done}</p> : null}
        {error ? <p className="biz-error" role="alert">{error}</p> : null}
        <Button variant={closed ? "outline" : undefined} disabled={busy} onClick={() => void run()}>{t(closed ? "bx_adminMonthAgain" : "bx_adminMonthRun")}</Button>
      </section>
      <section className="biz-card">
        <div className="biz-card-head"><strong>{t("bx_adminRuns")}</strong></div>
        {runs.length === 0 ? <p className="biz-help">{t("bx_adminRunsEmpty")}</p> : (
          <ul className="biz-runs">
            {runs.map((r) => (
              <li key={r.period}>
                <strong>{monthName(r.period)}</strong>
                <span>{t("bx_adminMonthDone", { invoices: String(r.invoices), plans: String(r.planCharges) })}</span>
                <small>{t(r.ranBy ? "bx_adminRunByAdmin" : "bx_adminRunAuto")} · {new Date(r.ranAt).toLocaleString()}</small>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
