import { APP_NAME, COMPANY_LOCATION, COMPANY_NAME } from "../config/constants";
import { GigzenMark } from "./GigzenMark";
import { useLangStore, useT } from "../i18n";

/**
 * Names the company the policy is an agreement with.
 *
 * Both policies used to say "we", "our" and "the app" and never once name the
 * company. A privacy policy that does not identify its controller does not tell
 * the reader who holds their data.
 */
export function LegalOperator() {
  const t = useT();
  return (
    <p className="legal-operator">
      <GigzenMark size={14} />
      <span>
        {t("legal_operator", {
          app: APP_NAME,
          company: COMPANY_NAME,
          location: COMPANY_LOCATION,
        })}
      </span>
    </p>
  );
}

/**
 * Shown above translated legal text.
 *
 * The policies are translated so a driver can read what they are agreeing to,
 * but only the English text has been reviewed as the binding version. Saying so
 * is the honest thing to do, and it is what keeps a translated convenience copy
 * from being mistaken for the contract. Hidden on English, where there is
 * nothing to disclaim.
 */
export function LegalNotice() {
  const t = useT();
  const lang = useLangStore((state) => state.lang);
  if (lang === "en") return null;
  return <p className="legal-notice">{t("legal_authoritative")}</p>;
}
