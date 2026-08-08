import { Link } from "react-router-dom";
import { APP_NAME, SUPPORT_EMAIL } from "../config/constants";
import { useT } from "../i18n";
import { LegalNotice } from "../components/LegalNotice";

export function TermsScreen() {
  const t = useT();
  const app = { app: APP_NAME };

  return (
    <main className="legal-page">
      <header>
        <Link to="/auth">← {t("legal_back")}</Link>
        <h1>{t("terms_title")}</h1>
        <p>{t("legal_updated")}</p>
      </header>

      <LegalNotice />

      <section>
        <h2>{t("terms_acceptance_h")}</h2>
        <p>{t("terms_acceptance_b", app)}</p>
      </section>

      <section>
        <h2>{t("terms_eligibility_h")}</h2>
        <p>{t("terms_eligibility_b")}</p>
      </section>

      <section>
        <h2>{t("terms_use_h")}</h2>
        <ul>
          <li>{t("terms_use_1")}</li>
          <li>{t("terms_use_2")}</li>
          <li>{t("terms_use_3")}</li>
        </ul>
      </section>

      <section>
        <h2>{t("terms_safety_h")}</h2>
        <p>{t("terms_safety_b", app)}</p>
      </section>

      <section>
        <h2>{t("terms_termination_h")}</h2>
        <p>{t("terms_termination_b")}</p>
      </section>

      <section>
        <h2>{t("terms_disclaimer_h")}</h2>
        <p>{t("terms_disclaimer_b")}</p>
      </section>

      <section>
        <h2>{t("terms_contact_h")}</h2>
        <p>
          {t("terms_contact_label")}: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        </p>
      </section>
    </main>
  );
}
