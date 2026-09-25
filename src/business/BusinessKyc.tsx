import { BadgeCheck, Camera, CircleDashed, ImagePlus, ShieldCheck } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "../components/ui/Button";
import { useT, type TKey } from "../i18n";
import { shrinkImage } from "../utils/shrinkImage";
import { BusinessTop } from "./BusinessScreens";
import {
  BusinessService,
  CATEGORY_GROUPS,
  licenceFor,
  STATES,
  type Business,
  type BusinessKind,
  type DocKind,
  type EntityType,
  type KycForm,
  type ProofType,
} from "./BusinessService";

/* ------------------------------------------------------------------ categories */

/** Every kind of shop, grouped, one tap each. */
export function CategoryPicker({ value, onChange }: { value: BusinessKind; onChange: (kind: BusinessKind) => void }) {
  const t = useT();
  return (
    <div className="biz-categories">
      {CATEGORY_GROUPS.map((g) => (
        <div key={g.group} className="biz-category-group">
          <span>{t(`bx_group_${g.group}` as TKey)}</span>
          <div className="biz-chips" role="radiogroup" aria-label={t(`bx_group_${g.group}` as TKey)}>
            {g.kinds.map((kind) => (
              <button key={kind} type="button" role="radio" aria-checked={value === kind}
                className={`biz-chip${value === kind ? " is-on" : ""}`} onClick={() => onChange(kind)}>
                {t(`bx_kind_${kind}` as TKey)}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ what is missing */

/** The database's names for what is missing, in the order the form asks for them. */
const MISSING_LABEL: Record<string, TKey> = {
  entity_type: "bx_miss_entity",
  owner_name: "bx_miss_owner",
  pan: "bx_miss_pan",
  aadhaar: "bx_miss_aadhaar",
  state: "bx_miss_state",
  doc_pan: "bx_miss_docPan",
  doc_aadhaar: "bx_miss_docAadhaar",
  doc_selfie: "bx_miss_docSelfie",
  doc_shopfront: "bx_miss_docShop",
  payout: "bx_miss_payout",
  fssai: "bx_miss_fssai",
  doc_fssai: "bx_miss_docFssai",
  drug_licence: "bx_miss_drug",
  doc_drug_licence: "bx_miss_docDrug",
  proof: "bx_miss_proof",
  gst: "bx_miss_gst",
  fssai_expiry: "bx_miss_fssaiExpiry",
  fssai_expired: "bx_miss_fssaiExpired",
  drug_expiry: "bx_miss_drugExpiry",
  drug_expired: "bx_miss_drugExpired",
};

/** Items that only appear when something has gone wrong, not on every checklist. */
const ONLY_WHEN_MISSING = ["fssai_expired", "drug_expired"];

/** The list on the waiting screen: done, and still to do. */
export function KycChecklist({ business, missing }: { business: Business; missing: string[] }) {
  const t = useT();
  const licence = licenceFor(business.kind);
  const all = Object.keys(MISSING_LABEL).filter((key) => {
    if (ONLY_WHEN_MISSING.includes(key)) return missing.includes(key);
    if (key === "fssai" || key === "doc_fssai" || key === "fssai_expiry") return licence === "fssai";
    if (key === "drug_licence" || key === "doc_drug_licence" || key === "drug_expiry") return licence === "drug";
    return true;
  });
  const done = all.length - missing.length;
  return (
    <div className="biz-checklist">
      <div className="biz-progress" aria-label={t("bx_kycProgress", { done: String(done), all: String(all.length) })}>
        <span style={{ width: `${Math.round((done / all.length) * 100)}%` }} />
      </div>
      <p className="biz-help">{t("bx_kycProgress", { done: String(done), all: String(all.length) })}</p>
      <ul>
        {all.map((key) => (
          <li key={key} className={missing.includes(key) ? "" : "is-done"}>
            {missing.includes(key) ? <CircleDashed size={16} /> : <BadgeCheck size={16} />}
            {t(MISSING_LABEL[key])}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ the owner and papers */

const ENTITIES: { id: EntityType; label: TKey }[] = [
  { id: "proprietor", label: "bx_ent_proprietor" },
  { id: "partnership", label: "bx_ent_partnership" },
  { id: "llp", label: "bx_ent_llp" },
  { id: "private_ltd", label: "bx_ent_private" },
  { id: "public_ltd", label: "bx_ent_public" },
  { id: "trust", label: "bx_ent_trust" },
  { id: "other", label: "bx_ent_other" },
];

const PROOFS: { id: ProofType; label: TKey; ph: string }[] = [
  { id: "gst", label: "bx_proof_gst", ph: "21ABCDE1234F1Z5" },
  { id: "establishment", label: "bx_proof_establishment", ph: "BMC/SE/2024/012345" },
  { id: "trade_licence", label: "bx_proof_trade", ph: "BMC/TL/2025/0456" },
  { id: "udyam", label: "bx_proof_udyam", ph: "UDYAM-OD-19-0012345" },
];

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const UPI_RE = /^[a-zA-Z0-9._-]{2,255}@[a-zA-Z]{2,64}$/;
const UDYAM_RE = /^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$/;

export function VerifyBusinessScreen({
  business,
  onSaved,
  onBack,
  nav,
}: {
  business: Business;
  onSaved: (business: Business) => void;
  onBack?: () => void;
  nav?: ReactNode;
}) {
  const t = useT();
  const licence = licenceFor(business.kind);
  const [entityType, setEntityType] = useState<EntityType>(business.entityType ?? "proprietor");
  const [ownerName, setOwnerName] = useState(business.ownerName ?? "");
  const [pan, setPan] = useState(business.pan ?? "");
  const [aadhaarLast4, setAadhaarLast4] = useState(business.aadhaarLast4 ?? "");
  const [stateCode, setStateCode] = useState(business.stateCode ?? "21");
  const [gstin, setGstin] = useState(business.gstin ?? "");
  const [fssai, setFssai] = useState(business.fssai ?? "");
  const [drugLicence, setDrugLicence] = useState(business.drugLicence ?? "");
  const [udyam, setUdyam] = useState(business.udyam ?? "");
  const [payoutMethod, setPayoutMethod] = useState<"bank" | "upi">(business.payoutMethod ?? "bank");
  const [bankAccountName, setBankAccountName] = useState(business.bankAccountName ?? "");
  const [bankAccountNumber, setBankAccountNumber] = useState(business.bankAccountNumber ?? "");
  const [confirmNumber, setConfirmNumber] = useState(business.bankAccountNumber ?? "");
  const [bankIfsc, setBankIfsc] = useState(business.bankIfsc ?? "");
  const [payoutUpi, setPayoutUpi] = useState(business.payoutUpi ?? "");
  const [proofType, setProofType] = useState<ProofType>(business.proofType ?? (business.gstin ? "gst" : "establishment"));
  const [proofNumber, setProofNumber] = useState(business.proofNumber ?? "");
  const [gstExempt, setGstExempt] = useState(Boolean(business.gstExemptDeclaredAt));
  const [fssaiExpiresOn, setFssaiExpiresOn] = useState(business.fssaiExpiresOn ?? "");
  const [drugLicenceExpiresOn, setDrugLicenceExpiresOn] = useState(business.drugLicenceExpiresOn ?? "");
  const today = new Date().toISOString().slice(0, 10);
  const [photos, setPhotos] = useState<Partial<Record<DocKind, File>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const proprietor = entityType === "proprietor";

  const docs: { kind: DocKind; label: TKey; help?: TKey; capture: "user" | "environment"; needed: boolean }[] = [
    { kind: "pan", label: "bx_docPan", capture: "environment", needed: true },
    { kind: "aadhaar", label: "bx_docAadhaar", help: "bx_docAadhaarHelp", capture: "environment", needed: true },
    { kind: "selfie", label: "bx_docSelfie", capture: "user", needed: true },
    { kind: "shopfront", label: "bx_docShop", help: "bx_docShopHelp", capture: "environment", needed: true },
    ...(licence === "fssai" ? [{ kind: "fssai" as DocKind, label: "bx_docFssai" as TKey, capture: "environment" as const, needed: true }] : []),
    ...(licence === "drug" ? [{ kind: "drug_licence" as DocKind, label: "bx_docDrug" as TKey, capture: "environment" as const, needed: true }] : []),
    { kind: "proof", label: "bx_docProof", help: "bx_docProofHelp", capture: "environment", needed: true },
  ];

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const P = pan.trim().toUpperCase();
    const G = gstin.trim().toUpperCase();
    const problems: TKey[] = [];
    if (ownerName.trim().length < 2) problems.push("bx_errOwner");
    if (!PAN_RE.test(P)) problems.push("bx_errPan");
    if (!/^[0-9]{4}$/.test(aadhaarLast4)) problems.push("bx_errAadhaar");
    if (G && !GSTIN_RE.test(G)) problems.push("bx_errGstin");
    if (G && GSTIN_RE.test(G) && G.slice(2, 12) !== P) problems.push("bx_errGstinPan");
    if (G && GSTIN_RE.test(G) && G.slice(0, 2) !== stateCode) problems.push("bx_errGstinState");
    if (licence === "fssai" && !/^[0-9]{14}$/.test(fssai)) problems.push("bx_errFssai");
    if (licence === "drug" && !/^[A-Za-z0-9/ .()-]{4,40}$/.test(drugLicence.trim())) problems.push("bx_errDrug");
    if (udyam.trim() && !UDYAM_RE.test(udyam.trim().toUpperCase())) problems.push("bx_errUdyam");
    if (!G && !gstExempt) problems.push("bx_errGstOrDeclare");
    if (!/^[A-Za-z0-9/ .()-]{4,40}$/.test(proofNumber.trim())) problems.push("bx_errProof");
    else if (proofType === "gst" && proofNumber.trim().toUpperCase() !== G) problems.push("bx_errProofGst");
    if (licence === "fssai" && (!fssaiExpiresOn || fssaiExpiresOn < today)) problems.push("bx_errFssaiExpiry");
    if (licence === "drug" && (!drugLicenceExpiresOn || drugLicenceExpiresOn < today)) problems.push("bx_errDrugExpiry");
    if (payoutMethod === "bank") {
      if (bankAccountName.trim().length < 2 || !/^[0-9]{9,18}$/.test(bankAccountNumber) || !IFSC_RE.test(bankIfsc.trim().toUpperCase())) problems.push("bx_errBank");
      else if (bankAccountNumber !== confirmNumber) problems.push("bx_errBankConfirm");
    } else if (!UPI_RE.test(payoutUpi.trim())) problems.push("bx_errUpi");
    const missingPhotos = docs.filter((d) => !photos[d.kind] && !business.docs[d.kind]);
    if (missingPhotos.length) problems.push("bx_errPhotos");
    if (problems.length) {
      setError(problems.map((p) => t(p)).join(" "));
      return;
    }

    setBusy(true);
    try {
      const shrunk: Partial<Record<DocKind, Blob>> = {};
      for (const [kind, file] of Object.entries(photos) as [DocKind, File][]) shrunk[kind] = await shrinkImage(file);
      const form: KycForm = {
        entityType, ownerName, pan: P, aadhaarLast4, stateCode, gstin: G, fssai, drugLicence, udyam,
        payoutMethod, bankAccountName, bankAccountNumber, bankIfsc, payoutUpi,
        proofType, proofNumber, gstExempt: gstExempt && !G, fssaiExpiresOn, drugLicenceExpiresOn,
      };
      const saved = await BusinessService.saveKyc(business, form, shrunk);
      setPhotos({});
      setSent(true);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("biz_errGeneric"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="biz-frame">
      <BusinessTop business={business}>
        <div className="biz-top-business">
          {onBack ? <button type="button" className="biz-back" onClick={onBack}>← {t("biz_back")}</button> : null}
          <h1>{t("bx_kycTitle")}</h1>
          <p>{t("bx_kycSub")}</p>
        </div>
      </BusinessTop>
      {nav}
      <form className="biz-body" onSubmit={submit}>
        {business.status === "verified" ? <p className="biz-note">{t("bx_kycVerifiedWarn")}</p> : null}
        {sent ? <p className="biz-ok" role="status"><ShieldCheck size={16} /> {t("bx_kycSent")}</p> : null}

        <section className="biz-card">
          <div className="biz-card-head"><strong>{t("bx_kycOwner")}</strong></div>
          <div className="biz-field">
            <span>{t("bx_entity")}</span>
            <div className="biz-chips" role="radiogroup" aria-label={t("bx_entity")}>
              {ENTITIES.map((e) => (
                <button key={e.id} type="button" role="radio" aria-checked={entityType === e.id}
                  className={`biz-chip${entityType === e.id ? " is-on" : ""}`} onClick={() => setEntityType(e.id)}>
                  {t(e.label)}
                </button>
              ))}
            </div>
          </div>
          <label className="biz-field"><span>{t(proprietor ? "bx_ownerName" : "bx_signatory")}</span>
            <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} autoComplete="name" maxLength={80} />
          </label>
          <div className="biz-row">
            <label className="biz-field"><span>{t(proprietor ? "bx_panOwn" : "bx_panBusiness")}</span>
              <input value={pan} onChange={(e) => setPan(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="ABCDE1234F" maxLength={10} autoCapitalize="characters" />
            </label>
            <label className="biz-field"><span>{t("bx_aadhaarLast4")}</span>
              <input value={aadhaarLast4} onChange={(e) => setAadhaarLast4(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="1234" inputMode="numeric" maxLength={4} />
            </label>
          </div>
          <p className="biz-help">{t("bx_aadhaarWhy")}</p>
        </section>

        <section className="biz-card">
          <div className="biz-card-head"><strong>{t("bx_kycTax")}</strong></div>
          <label className="biz-field"><span>{t("bx_state")}</span>
            <select value={stateCode} onChange={(e) => setStateCode(e.target.value)}>
              {STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </select>
          </label>
          <label className="biz-field"><span>{t("bx_gstin")}</span>
            <input value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="21ABCDE1234F1Z5" maxLength={15} />
          </label>
          <p className="biz-help">{t("bx_gstinHelp")}</p>
          {!gstin ? (
            <label className="biz-declare">
              <input type="checkbox" checked={gstExempt} onChange={(e) => setGstExempt(e.target.checked)} />
              <span>{t("bx_gstDeclare")}</span>
            </label>
          ) : null}
          {licence === "fssai" ? (
            <div className="biz-row">
              <label className="biz-field"><span>{t("bx_fssai")}</span>
                <input value={fssai} onChange={(e) => setFssai(e.target.value.replace(/\D/g, ""))} placeholder="12345678901234" inputMode="numeric" maxLength={14} />
              </label>
              <label className="biz-field"><span>{t("bx_validTill")}</span>
                <input type="date" value={fssaiExpiresOn} min={today} onChange={(e) => setFssaiExpiresOn(e.target.value)} />
              </label>
            </div>
          ) : null}
          {licence === "drug" ? (
            <div className="biz-row">
              <label className="biz-field"><span>{t("bx_drug")}</span>
                <input value={drugLicence} onChange={(e) => setDrugLicence(e.target.value)} placeholder="OD-KHU-20B-12345" maxLength={40} />
              </label>
              <label className="biz-field"><span>{t("bx_validTill")}</span>
                <input type="date" value={drugLicenceExpiresOn} min={today} onChange={(e) => setDrugLicenceExpiresOn(e.target.value)} />
              </label>
            </div>
          ) : null}
        </section>

        <section className="biz-card">
          <div className="biz-card-head"><strong>{t("bx_proofTitle")}</strong></div>
          <p className="biz-help">{t("bx_proofWhy")}</p>
          <div className="biz-chips" role="radiogroup" aria-label={t("bx_proofTitle")}>
            {PROOFS.map((pr) => (
              <button key={pr.id} type="button" role="radio" aria-checked={proofType === pr.id}
                className={`biz-chip${proofType === pr.id ? " is-on" : ""}`}
                onClick={() => { setProofType(pr.id); if (pr.id === "gst" && gstin) setProofNumber(gstin); }}>
                {t(pr.label)}
              </button>
            ))}
          </div>
          <label className="biz-field"><span>{t("bx_proofNumber")}</span>
            <input value={proofNumber} onChange={(e) => setProofNumber(e.target.value.toUpperCase())}
              placeholder={PROOFS.find((pr) => pr.id === proofType)?.ph} maxLength={40} />
          </label>
          <label className="biz-field"><span>{t("bx_udyam")}</span>
            <input value={udyam} onChange={(e) => setUdyam(e.target.value.toUpperCase())} placeholder="UDYAM-OD-19-0012345" maxLength={19} />
          </label>
        </section>

        <section className="biz-card">
          <div className="biz-card-head"><strong>{t("bx_kycPhotos")}</strong></div>
          <p className="biz-help">{t("bx_kycPhotosHelp")}</p>
          <div className="verify-photos biz-photos">
            {docs.map((d) => (
              <DocPhoto key={d.kind} business={business} kind={d.kind} label={t(d.label)} help={d.help ? t(d.help) : undefined}
                capture={d.capture} file={photos[d.kind] ?? null}
                onPick={(file) => setPhotos((p) => ({ ...p, [d.kind]: file ?? undefined }))} />
            ))}
          </div>
        </section>

        <section className="biz-card">
          <div className="biz-card-head"><strong>{t("bx_kycPayout")}</strong></div>
          <p className="biz-help">{t("bx_payoutWhy")}</p>
          <div className="biz-chips" role="radiogroup" aria-label={t("bx_kycPayout")}>
            <button type="button" role="radio" aria-checked={payoutMethod === "bank"} className={`biz-chip${payoutMethod === "bank" ? " is-on" : ""}`} onClick={() => setPayoutMethod("bank")}>{t("bx_payoutBank")}</button>
            <button type="button" role="radio" aria-checked={payoutMethod === "upi"} className={`biz-chip${payoutMethod === "upi" ? " is-on" : ""}`} onClick={() => setPayoutMethod("upi")}>{t("bx_payoutUpi")}</button>
          </div>
          {payoutMethod === "bank" ? (
            <>
              <label className="biz-field"><span>{t("bx_bankName")}</span>
                <input value={bankAccountName} onChange={(e) => setBankAccountName(e.target.value)} maxLength={80} />
              </label>
              <div className="biz-row">
                <label className="biz-field"><span>{t("bx_bankNumber")}</span>
                  <input value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value.replace(/\D/g, ""))} inputMode="numeric" maxLength={18} autoComplete="off" />
                </label>
                <label className="biz-field"><span>{t("bx_bankConfirm")}</span>
                  <input value={confirmNumber} onChange={(e) => setConfirmNumber(e.target.value.replace(/\D/g, ""))} inputMode="numeric" maxLength={18} autoComplete="off" onPaste={(e) => e.preventDefault()} />
                </label>
              </div>
              <label className="biz-field"><span>{t("bx_ifsc")}</span>
                <input value={bankIfsc} onChange={(e) => setBankIfsc(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="SBIN0001234" maxLength={11} />
              </label>
            </>
          ) : (
            <label className="biz-field"><span>{t("bx_upiId")}</span>
              <input value={payoutUpi} onChange={(e) => setPayoutUpi(e.target.value.trim())} placeholder="shopname@okaxis" autoCapitalize="none" maxLength={120} />
            </label>
          )}
        </section>

        {error ? <p className="biz-error" role="alert">{error}</p> : null}
        <Button type="submit" disabled={busy} className="biz-primary">{busy ? t("bx_kycSending") : t("bx_kycSubmit")}</Button>
      </form>
    </div>
  );
}

function DocPhoto({
  business,
  kind,
  label,
  help,
  capture,
  file,
  onPick,
}: {
  business: Business;
  kind: DocKind;
  label: string;
  help?: string;
  capture: "user" | "environment";
  file: File | null;
  onPick: (file: File | null) => void;
}) {
  const t = useT();
  const [preview, setPreview] = useState<string | null>(null);
  const saved = business.docs[kind];

  useEffect(() => {
    if (file) {
      const url = URL.createObjectURL(file);
      setPreview(url);
      return () => URL.revokeObjectURL(url);
    }
    let live = true;
    setPreview(null);
    if (saved) void BusinessService.docUrl(saved, "business-docs").then((u) => live && setPreview(u));
    return () => { live = false; };
  }, [file, saved]);

  return (
    <label className={`verify-photo${preview ? " has-photo" : ""}`}>
      <input type="file" accept="image/*" capture={capture} onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
      {preview ? <img src={preview} alt="" /> : capture === "user" ? <Camera size={24} /> : <ImagePlus size={24} />}
      <span>{label} <b className="biz-required" aria-label={t("bx_required")}>*</b></span>
      {help ? <small>{help}</small> : null}
      {saved && !file ? <small className="biz-photo-saved">{t("bx_photoSaved")}</small> : null}
    </label>
  );
}
