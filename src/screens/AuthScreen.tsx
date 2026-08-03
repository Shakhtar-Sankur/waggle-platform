import { Eye, EyeOff, Lock, MapPin, Phone, UserRound, Zap } from "lucide-react";
import { BeeMark } from "../components/Wordmark";
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

const STRENGTH_LABELS = ["Too weak", "Weak", "Fair", "Good", "Strong"];
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
      setError("Please accept the Privacy Policy and Terms of Service.");
      return;
    }
    if (mode === "signup" && !passwordMeetsMinimum(password)) {
      setError("Password must be at least 8 characters and include a letter and a number.");
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
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <div className="brand-block">
          <div className="brand-icon">
            <BeeMark size={46} />
          </div>
          <h1 className="brand-name">{APP_NAME}</h1>
          <p>{t("auth_tagline")}</p>
          <div className="brand-mini-row">
            <span><MapPin size={18} /> {t("auth_track")}</span>
            <span><Zap size={18} /> {t("auth_earn")}</span>
            <span><UserRound size={18} /> {t("auth_connect")}</span>
          </div>
        </div>

        <form className="auth-form" onSubmit={submit}>
          {mode === "signup" ? (
            <label>
              <span>{t("auth_fullName")}</span>
              <div className="input-shell auth-input">
                <UserRound size={19} />
                <input
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="Enter your full name"
                  autoComplete="name"
                />
              </div>
            </label>
          ) : null}
          <label>
            <span>{t("auth_phone")}</span>
            <div className="input-shell auth-input">
              <Phone size={19} />
              <input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="09XX XXX XXXX"
                autoComplete="tel"
              />
            </div>
          </label>
          <label>
            <span>{t("auth_password")}</span>
            <div className="input-shell auth-input">
              <Lock size={19} />
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your password"
                type={showPassword ? "text" : "password"}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
              <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label="Show password">
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
                  {STRENGTH_LABELS[passwordScore(password)]} · min 8 chars, a letter and a number
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
                I agree to the{" "}
                <Link to="/privacy" target="_blank" rel="noreferrer">
                  Privacy Policy
                </Link>{" "}
                and{" "}
                <Link to="/terms" target="_blank" rel="noreferrer">
                  Terms of Service
                </Link>
                , including location collection while tracking.
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
      <p className="terms">
        By continuing, you agree to our{" "}
        <Link to="/terms">Terms of Service</Link> and{" "}
        <Link to="/privacy">Privacy Policy</Link>.
      </p>
    </main>
  );
}
