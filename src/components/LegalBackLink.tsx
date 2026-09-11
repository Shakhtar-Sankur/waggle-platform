import { Link, useLocation, useNavigate } from "react-router-dom";
import { useT } from "../i18n";

/**
 * "← Back" on the privacy and terms pages.
 *
 * Both pages hardcoded a link to /auth, which is where they are read from
 * before you have an account. A signed-in driver who opened the privacy policy
 * from Profile was dropped on the sign-in screen instead — looking, reasonably,
 * like the app had just logged them out.
 *
 * So: step back through history when there is somewhere to step back to, and
 * fall back to /auth only for someone who arrived at the URL directly, which is
 * the pre-account reader the original link was written for.
 */
export function LegalBackLink() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const canGoBack = location.key !== "default";

  if (!canGoBack) return <Link to="/auth">← {t("legal_back")}</Link>;
  return (
    <a
      href="#"
      onClick={(event) => {
        event.preventDefault();
        navigate(-1);
      }}
    >
      ← {t("legal_back")}
    </a>
  );
}
