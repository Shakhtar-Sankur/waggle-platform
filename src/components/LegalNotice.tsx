import { useLangStore, useT } from "../i18n";

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
