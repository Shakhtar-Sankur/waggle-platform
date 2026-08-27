import { Eye, EyeOff, Lock, Phone, UserRound } from "lucide-react";
import { BeeMark } from "../components/Wordmark";
import { GigzenByline } from "../components/GigzenMark";
import { FormEvent, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { APP_NAME } from "../config/constants";
import { useT } from "../i18n";
import { useAuthStore } from "../stores/useAuthStore";
import { Button } from "../components/ui/Button";

// Simple client-side password strength (0-4) for signup feedback + gating.
function passwordScore(pw: string): number {
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return score;
}

// Minimum bar to create an account: 8+ chars with at least one letter and one number.
function passwordMeetsMinimum(pw: string): boolean {
  return pw.length >= 8 && /[A-Za-z]/.test(pw) && /\d/.test(pw);
}

const STRENGTH_KEYS = ["pw_tooWeak", "pw_weak", "pw_fair", "pw_good", "pw_strong"] as const;
const STRENGTH_COLORS = ["#ef4444", "#ef4444", "#f59e0b", "#3b9e4f", "#16c784"];

export function AuthScreen() {
  const navigate = useNavigate();
  const t = useT();
  const user = useAuthStore((state) => state.user);
  const signIn = useAuthStore((state) => state.signIn);
  const signUp = useAuthStore((state) => state.signUp);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to="/home" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (mode === "signup" && !acceptedTerms) {
      setError(t("err_acceptTerms"));
      return;
    }
    if (mode === "signup" && !passwordMeetsMinimum(password)) {
      setError(t("err_passwordSignup"));
      return;
    }
    setLoading(true);
    try {
      if (mode === "login") {
        await signIn(phone, password);
      } else {
        await signUp(phone, password, fullName);
      }
      navigate("/home");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("err_unexpected"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-screen">
      <section className="auth-card">
        {/* The mark, the name, and nothing else.
            This block used to carry a tagline and a Track / Earn / Connect
            row with icons — a landing-page feature strip. A driver opening
            the app to sign in has already chosen it; selling it back to them
            at the door is what made this read as a web page rather than an
            app. */}
        <div className="brand-block">
          <div className="brand-icon">
            <BeeMark size={54} />
          </div>
          <h1 className="brand-name">{APP_NAME}</h1>
        </div>

        <form className="auth-form" onSubmit={submit}>
          {mode === "signup" ? (
            <label>
              {/* Labels are visually hidden, not deleted. The placeholder says
                  the same thing to someone who can see the field, but a screen
                  reader needs a real label, and a placeholder is not one. */}
              <span className="sr-only">{t("auth_fullName")}</span>
              <div className="input-shell auth-input">
                <UserRound size={19} />
                <input
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder={t("auth_phName")}
                  autoComplete="name"
                />
              </div>
            </label>
          ) : null}
          <label>
            <span className="sr-only">{t("auth_phone")}</span>
            <div className="input-shell auth-input">
              <Phone size={19} />
              <input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder={t("auth_phPhone")}
                autoComplete="tel"
                inputMode="tel"
              />
            </div>
          </label>
          <label>
            <span className="sr-only">{t("auth_password")}</span>
            <div className="input-shell auth-input">
              <Lock size={19} />
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={t("auth_phPassword")}
                type={showPassword ? "text" : "password"}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? t("auth_hidePassword") : t("auth_showPassword")}
              >
                {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
              </button>
            </div>
            {mode === "signup" && password ? (
              <div className="pw-strength">
                <div className="pw-bars">
                  {[0, 1, 2, 3].map((i) => (
                    <span
                      key={i}
                      style={{
                        background: i < passwordScore(password) ? STRENGTH_COLORS[passwordScore(password)] : "rgba(255,255,255,0.25)",
                      }}
                    />
                  ))}
                </div>
                <small style={{ color: STRENGTH_COLORS[passwordScore(password)] }}>
                  {t(STRENGTH_KEYS[passwordScore(password)])}
                  {/* The rule is guidance until it is met; once it is, it is just noise. */}
                  {passwordMeetsMinimum(password) ? null : ` · ${t("pw_rule")}`}
                </small>
              </div>
            ) : null}
          </label>
          {mode === "signup" ? (
            <label className="consent-checkbox">
              <input
                type="checkbox"
                checked={acceptedTerms}
                onChange={(event) => setAcceptedTerms(event.target.checked)}
              />
              <span>
                {t("auth_agreePrefix")}{" "}
                <Link to="/privacy" target="_blank" rel="noreferrer">
                  {t("consent_privacyPolicy")}
                </Link>{" "}
                {t("consent_and")}{" "}
                <Link to="/terms" target="_blank" rel="noreferrer">
                  {t("consent_terms")}
                </Link>
                {t("auth_agreeSuffix")}
              </span>
            </label>
          ) : null}
          {error ? <p className="auth-error">{error}</p> : null}
          <Button className="auth-submit" type="submit" disabled={loading}>
            {loading ? "…" : mode === "login" ? t("auth_login") : t("auth_createAccount")}
          </Button>
        </form>

        <p className="auth-toggle">
          {mode === "login" ? t("auth_noAccount") : t("auth_haveAccount")}{" "}
          <button
            type="button"
            onClick={() => {
              setError("");
              setMode(mode === "login" ? "signup" : "login");
            }}
          >
            {mode === "login" ? t("auth_signup") : t("auth_login")}
          </button>
        </p>
      </section>
      {/* dir="auto", not the inherited page direction.

          The legal strings are deliberately NOT machine-translated, so in a
          right-to-left language this line is English sitting inside an RTL
          container. The bidi algorithm then moves the trailing full stop to
          the front and it renders as ".and Privacy Policy" — seen in Hebrew on
          the first screen anyone opens.

          "auto" asks the browser to take direction from the first strong
          character in the line, so English reads left-to-right here while
          Arabic — which DOES have translated legal text — still reads
          right-to-left. Neither case needs to know about the other. */}
      <p className="terms" dir="auto">
        {t("auth_footerPrefix")} <Link to="/terms">{t("consent_terms")}</Link>{" "}
        {t("consent_and")} <Link to="/privacy">{t("consent_privacyPolicy")}</Link>.
      </p>
      {/* Who is asking for the phone number. It was in the hero, competing with
          the app's own name; it belongs at the foot, where a maker's byline
          normally sits. */}
      <div className="auth-byline">
        <GigzenByline tone="solid" />
      </div>
    </main>
  );
}
