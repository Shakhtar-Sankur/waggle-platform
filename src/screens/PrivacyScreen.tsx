import { Link } from "react-router-dom";
import { APP_NAME, PRIVACY_EMAIL } from "../config/constants";
import { useT } from "../i18n";
import { LegalNotice, LegalOperator } from "../components/LegalNotice";
import type { TKey } from "../i18n";

/**
 * "Account data: name, phone number…" renders with the part before the first
 * colon in bold. Keeping label and body in one translation string lets each
 * language put the colon where its own punctuation wants it, instead of forcing
 * an English sentence shape onto sixteen of them.
 */
function LabelledItem({ text }: { text: string }) {
  const split = text.indexOf(":");
  if (split === -1) return <li>{text}</li>;
  return (
    <li>
      <strong>{text.slice(0, split + 1)}</strong>
      {text.slice(split + 1)}
    </li>
  );
}

const COLLECTED: TKey[] = [
  "privacy_collect_1",
  "privacy_collect_2",
  "privacy_collect_3",
  "privacy_collect_4",
  "privacy_collect_5",
  "privacy_collect_6",
];

const USES: TKey[] = ["privacy_use_1", "privacy_use_2", "privacy_use_3", "privacy_use_4"];

export function PrivacyScreen() {
  const t = useT();

  return (
    <main className="legal-page">
      <header>
        <Link to="/auth">← {t("legal_back")}</Link>
        <h1>{t("privacy_title")}</h1>
        <p>{t("legal_updated")}</p>
      </header>

      <LegalNotice />
      <LegalOperator />

      <section>
        <h2>{t("privacy_overview_h")}</h2>
        <p>{t("privacy_overview_b", { app: APP_NAME })}</p>
      </section>

      <section>
        <h2>{t("privacy_collect_h")}</h2>
        <ul>
          {COLLECTED.map((key) => (
            <LabelledItem key={key} text={t(key)} />
          ))}
        </ul>
      </section>

      <section>
        <h2>{t("privacy_use_h")}</h2>
        <ul>
          {USES.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
      </section>

      <section>
        <h2>{t("privacy_sharing_h")}</h2>
        <p>{t("privacy_sharing_b")}</p>
      </section>

      <section>
        <h2>{t("privacy_retention_h")}</h2>
        <p>{t("privacy_retention_b")}</p>
      </section>

      <section>
        <h2>{t("privacy_rights_h")}</h2>
        <p>{t("privacy_rights_b")}</p>
      </section>

      <section>
        <h2>{t("privacy_contact_h")}</h2>
        <p>
          {t("privacy_contact_label")}: <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>
        </p>
      </section>
    </main>
  );
}
