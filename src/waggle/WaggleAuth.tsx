import { ChevronLeft, MessageSquareText, Smartphone, UserRound } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useT } from "../i18n";
import { useAuthStore } from "../stores/useAuthStore";
import { WgFrame } from "./common";

/** Phone sign-in is on only where an SMS provider is connected (VITE_OTP_ENABLED). */
export const OTP_ENABLED = import.meta.env.VITE_OTP_ENABLED === "true";

const RESEND_SECONDS = 30;
const pretty = (digits: string) => `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;

/**
 * Sign in with a mobile number and a 6-digit code: no password to make up or
 * forget. A first sign-in creates the account and then asks for a name.
 */
export function PhoneSignIn({ redirectTo = "/account" }: { redirectTo?: string }) {
  const t = useT();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const sendOtp = useAuthStore((s) => s.sendOtp);
  const verifyOtp = useAuthStore((s) => s.verifyOtp);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const [step, setStep] = useState<"phone" | "code" | "name">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [wait, setWait] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const codeRef = useRef<HTMLInputElement>(null);
  const digits = phone.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");
  const phoneOk = /^[6-9]\d{9}$/.test(digits);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [wait]);
  useEffect(() => { if (step === "code") codeRef.current?.focus(); }, [step]);

  // Only someone already signed in on arrival is sent on. Signing in here sets
  // the user too, and a new customer must still get the name step after it.
  const signedInOnArrival = useRef(Boolean(user));
  if (signedInOnArrival.current) return <Navigate to={redirectTo} replace />;

  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (!phoneOk || busy) return;
    setBusy(true);
    setError("");
    try {
      await sendOtp(digits);
      setCode("");
      setStep("code");
      setWait(RESEND_SECONDS);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      const after = message.match(/after (\d+) seconds?/i);
      setError(after ? t("otp_errWait", { s: after[1] }) : message || t("err_unexpected"));
    } finally {
      setBusy(false);
    }
  }

  async function check(value: string) {
    if (value.length !== 6 || busy) return;
    setBusy(true);
    setError("");
    try {
      const isNew = await verifyOtp(digits, value);
      if (isNew) setStep("name");
      else navigate(redirectTo, { replace: true });
    } catch (err) {
      setCode("");
      setError(/expired|invalid/i.test(err instanceof Error ? err.message : "") ? t("otp_errWrong") : err instanceof Error ? err.message : t("err_unexpected"));
    } finally {
      setBusy(false);
    }
  }

  function saveName(event: FormEvent) {
    event.preventDefault();
    if (name.trim().length < 2) { setError(t("err_nameMin")); return; }
    updateProfile({ fullName: name.trim() });
    navigate(redirectTo, { replace: true });
  }

  return (
    <WgFrame bar={<Link to="/" className="wg-back"><ChevronLeft size={18} /> {t("wg_backHome")}</Link>}>
      <main className="wg-page wg-otp">
        {step === "phone" ? (
          <form className="wg-card wg-otp-card" onSubmit={send}>
            <span className="wg-otp-icon"><Smartphone size={26} /></span>
            <h1>{t("otp_title")}</h1>
            <p>{t("otp_sub")}</p>
            <label className="wg-field"><span>{t("wg_phone")}</span>
              <div className="wg-otp-phone">
                <b>+91</b>
                <input className="wg-input" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel-national"
                  placeholder="98765 43210" maxLength={16} autoFocus />
              </div>
            </label>
            {error ? <p className="wg-error" role="alert">{error}</p> : null}
            <button type="submit" className="wg-btn wg-btn-primary wg-btn-block" disabled={!phoneOk || busy}>{busy ? "…" : t("otp_send")}</button>
            <p className="wg-fine">{t("otp_terms")}{" "}<Link to="/terms">{t("consent_terms")}</Link>{" · "}<Link to="/privacy">{t("consent_privacyPolicy")}</Link></p>
            <Link className="wg-link wg-otp-alt" to="/auth/password">{t("otp_usePassword")}</Link>
          </form>
        ) : step === "code" ? (
          <section className="wg-card wg-otp-card">
            <span className="wg-otp-icon"><MessageSquareText size={26} /></span>
            <h1>{t("otp_codeTitle")}</h1>
            <p>{t("otp_codeSub", { phone: pretty(digits) })}</p>
            <input ref={codeRef} className="wg-input wg-otp-code" value={code} inputMode="numeric" autoComplete="one-time-code" maxLength={6}
              aria-label={t("otp_codeTitle")} placeholder="• • • • • •"
              onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, 6); setCode(v); if (v.length === 6) void check(v); }} />
            {error ? <p className="wg-error" role="alert">{error}</p> : null}
            <button type="button" className="wg-btn wg-btn-primary wg-btn-block" disabled={code.length !== 6 || busy} onClick={() => void check(code)}>{busy ? "…" : t("otp_verify")}</button>
            <div className="wg-otp-row">
              <button type="button" className="wg-link" onClick={() => { setStep("phone"); setError(""); }}>{t("otp_change")}</button>
              <button type="button" className="wg-link" disabled={wait > 0 || busy} onClick={() => void send()}>
                {wait > 0 ? t("otp_resendIn", { s: String(wait) }) : t("otp_resend")}
              </button>
            </div>
          </section>
        ) : (
          <form className="wg-card wg-otp-card" onSubmit={saveName}>
            <span className="wg-otp-icon"><UserRound size={26} /></span>
            <h1>{t("otp_nameTitle")}</h1>
            <p>{t("otp_nameSub")}</p>
            <label className="wg-field"><span>{t("auth_fullName")}</span>
              <input className="wg-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={60} autoFocus />
            </label>
            {error ? <p className="wg-error" role="alert">{error}</p> : null}
            <button type="submit" className="wg-btn wg-btn-primary wg-btn-block">{t("otp_nameSave")}</button>
          </form>
        )}
      </main>
    </WgFrame>
  );
}
