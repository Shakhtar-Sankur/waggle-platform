import { Camera, ImagePlus, ShieldCheck } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { useT, type TKey } from "../i18n";
import type { VerificationForm } from "../services/SupabaseService";
import { useAuthStore } from "../stores/useAuthStore";
import { useNotificationStore } from "../stores/useNotificationStore";
import { useVerificationStore } from "../stores/useVerificationStore";
import { shrinkImage } from "../utils/shrinkImage";

const VEHICLES: { id: VerificationForm["vehicle"]; label: TKey; motor: boolean }[] = [
  { id: "bike", label: "ver_vehicleBike", motor: true },
  { id: "scooter", label: "ver_vehicleScooter", motor: true },
  { id: "ev_scooter", label: "ver_vehicleEv", motor: true },
  { id: "auto", label: "ver_vehicleAuto", motor: true },
  { id: "car", label: "ver_vehicleCar", motor: true },
  { id: "bicycle", label: "ver_vehicleBicycle", motor: false },
  { id: "on_foot", label: "ver_vehicleFoot", motor: false },
];

const IDS: { id: VerificationForm["idType"]; label: TKey }[] = [
  { id: "aadhaar_masked", label: "ver_idAadhaar" },
  { id: "voter_id", label: "ver_idVoter" },
  { id: "pan", label: "ver_idPan" },
  { id: "driving_licence", label: "ver_idLicence" },
  { id: "passport", label: "ver_idPassport" },
];

/**
 * Getting verified to take Waggle jobs. Gigzen checks every worker once: shops
 * hand them real orders and customers open their doors to them. Documents go to
 * a private store that only the worker and Gigzen's admins can open.
 */
export function VerificationScreen({ preview = false }: { preview?: boolean }) {
  const t = useT();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const verification = useVerificationStore((state) => state.verification);
  const load = useVerificationStore((state) => state.load);
  const submitForm = useVerificationStore((state) => state.submit);
  const push = useNotificationStore((state) => state.push);

  const [legalName, setLegalName] = useState("");
  const [vehicle, setVehicle] = useState<VerificationForm["vehicle"]>("bike");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [licenceNumber, setLicenceNumber] = useState("");
  const [upiId, setUpiId] = useState("");
  const [idType, setIdType] = useState<VerificationForm["idType"]>("aadhaar_masked");
  const [idPhoto, setIdPhoto] = useState<File | null>(null);
  const [selfie, setSelfie] = useState<File | null>(null);
  const [licencePhoto, setLicencePhoto] = useState<File | null>(null);
  const [rcPhoto, setRcPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (user && !preview) void load(user.id);
  }, [user, load, preview]);

  // Resubmitting after a rejection starts from what was sent.
  useEffect(() => {
    if (!verification) return;
    setLegalName(verification.legalName);
    setVehicle(verification.vehicle as VerificationForm["vehicle"]);
    setVehicleNumber(verification.vehicleNumber ?? "");
    setLicenceNumber(verification.licenceNumber ?? "");
    setUpiId(verification.upiId);
    setIdType(verification.idType as VerificationForm["idType"]);
  }, [verification]);

  const motor = VEHICLES.find((v) => v.id === vehicle)?.motor ?? false;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const upiOk = /^[a-zA-Z0-9._-]{2,255}@[a-zA-Z]{2,64}$/.test(upiId.trim());
    if (legalName.trim().length < 2 || !upiOk || !idPhoto || !selfie
        || (motor && (!vehicleNumber.trim() || !licenceNumber.trim() || !licencePhoto || !rcPhoto))) {
      setError(t("ver_errFields"));
      return;
    }
    if (preview || !user) return;
    setBusy(true);
    try {
      await submitForm(
        user.id,
        { legalName, vehicle, vehicleNumber: motor ? vehicleNumber : undefined, licenceNumber: motor ? licenceNumber : undefined, upiId, idType },
        await shrinkImage(idPhoto),
        await shrinkImage(selfie),
        motor && licencePhoto ? await shrinkImage(licencePhoto) : undefined,
        motor && rcPhoto ? await shrinkImage(rcPhoto) : undefined,
      );
      push(t("ver_title"), t("ver_sent"), "system");
      navigate("/home");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("job_stepError"));
    } finally {
      setBusy(false);
    }
  }

  const waiting = verification?.status === "pending";

  return (
    <main className="page-shell verify-screen">
      <section className="dashboard-card glass-card">
        <div className="verify-head">
          <span className="verify-icon"><ShieldCheck size={24} /></span>
          <div>
            <h3>{t("ver_title")}</h3>
            <p>{t("ver_sub")}</p>
          </div>
        </div>
        {waiting ? <p className="verify-banner">{t("ver_pendingTitle")}. {t("ver_pendingBody")}</p> : null}
        {verification?.status === "rejected" && verification.reviewNote ? (
          <blockquote className="verify-note"><strong>{t("ver_rejectedTitle")}</strong>{verification.reviewNote}</blockquote>
        ) : null}
      </section>

      <form className="verify-form" onSubmit={submit}>
        <section className="dashboard-card glass-card">
          <label className="field"><span>{t("ver_legalName")}</span>
            <input value={legalName} onChange={(e) => setLegalName(e.target.value)} autoComplete="name" maxLength={80} />
          </label>
          <div className="field"><span>{t("ver_vehicle")}</span>
            <div className="verify-chips" role="radiogroup">
              {VEHICLES.map((v) => (
                <button key={v.id} type="button" role="radio" aria-checked={vehicle === v.id} className={vehicle === v.id ? "is-on" : ""} onClick={() => setVehicle(v.id)}>
                  {t(v.label)}
                </button>
              ))}
            </div>
          </div>
          {motor ? (
            <>
              <label className="field"><span>{t("ver_vehicleNumber")}</span>
                <input value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())} placeholder="OD 02 AB 1234" maxLength={15} />
              </label>
              <label className="field"><span>{t("ver_licence")}</span>
                <input value={licenceNumber} onChange={(e) => setLicenceNumber(e.target.value.toUpperCase())} placeholder="OD0220190001234" maxLength={20} />
              </label>
            </>
          ) : null}
          <label className="field"><span>{t("ver_upi")}</span>
            <input value={upiId} onChange={(e) => setUpiId(e.target.value.trim())} placeholder={t("ver_upiPh")} autoCapitalize="none" maxLength={120} />
          </label>
        </section>

        <section className="dashboard-card glass-card">
          <div className="field"><span>{t("ver_idType")}</span>
            <div className="verify-chips" role="radiogroup">
              {IDS.map((d) => (
                <button key={d.id} type="button" role="radio" aria-checked={idType === d.id} className={idType === d.id ? "is-on" : ""} onClick={() => setIdType(d.id)}>
                  {t(d.label)}
                </button>
              ))}
            </div>
          </div>
          {idType === "aadhaar_masked" ? <p className="micro-copy">{t("ver_aadhaarNote")}</p> : null}
          <div className="verify-photos">
            <label className={`verify-photo${idPhoto ? " has-photo" : ""}`}>
              <input type="file" accept="image/*" capture="environment" onChange={(e) => setIdPhoto(e.target.files?.[0] ?? null)} />
              {idPhoto ? <img src={URL.createObjectURL(idPhoto)} alt="" /> : <ImagePlus size={24} />}
              <span>{t("ver_idPhoto")}</span>
            </label>
            <label className={`verify-photo${selfie ? " has-photo" : ""}`}>
              <input type="file" accept="image/*" capture="user" onChange={(e) => setSelfie(e.target.files?.[0] ?? null)} />
              {selfie ? <img src={URL.createObjectURL(selfie)} alt="" /> : <Camera size={24} />}
              <span>{t("ver_selfie")}</span>
            </label>
            {motor ? (
              <>
                <label className={`verify-photo${licencePhoto ? " has-photo" : ""}`}>
                  <input type="file" accept="image/*" capture="environment" onChange={(e) => setLicencePhoto(e.target.files?.[0] ?? null)} />
                  {licencePhoto ? <img src={URL.createObjectURL(licencePhoto)} alt="" /> : <ImagePlus size={24} />}
                  <span>{t("ver_licencePhoto")}</span>
                </label>
                <label className={`verify-photo${rcPhoto ? " has-photo" : ""}`}>
                  <input type="file" accept="image/*" capture="environment" onChange={(e) => setRcPhoto(e.target.files?.[0] ?? null)} />
                  {rcPhoto ? <img src={URL.createObjectURL(rcPhoto)} alt="" /> : <ImagePlus size={24} />}
                  <span>{t("ver_rcPhoto")}</span>
                </label>
              </>
            ) : null}
          </div>
        </section>

        {error ? <p className="verify-error" role="alert">{error}</p> : null}
        <div className="tracking-actions">
          <Button type="submit" disabled={busy}>{t(verification?.status === "rejected" ? "ver_fix" : "ver_submit")}</Button>
        </div>
      </form>
    </main>
  );
}
