import { MapPin, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useT } from "../i18n";
import { useAuthStore } from "../stores/useAuthStore";
import { useConsentStore } from "../stores/useConsentStore";
import { Button } from "./ui/Button";
import { Modal } from "./ui/Modal";

export function ConsentGate() {
  const t = useT();
  const user = useAuthStore((state) => state.user);
  // Shared, because HomeScreen must not open its own modal in front of this one.
  const accepted = useConsentStore((state) => state.accepted);
  const accept = useConsentStore((state) => state.accept);
  const [locationAck, setLocationAck] = useState(false);
  const [privacyAck, setPrivacyAck] = useState(false);

  // Don't hijack the login screen. Someone reinstalling the app shouldn't have
  // to agree to data terms before they can even reach the password field —
  // consent belongs after sign-in, right before they start driving.
  if (!user) return null;
  if (accepted) return null;

  const canContinue = locationAck && privacyAck;

  return (
    <Modal
      open
      onClose={() => undefined}
      title={t("consent_title")}
      description={t("consent_intro")}
    >
      <div className="consent-panel">
        <article className="consent-item">
          <MapPin size={22} />
          <div>
            <strong>{t("consent_locationTitle")}</strong>
            <p>{t("consent_locationBody")}</p>
          </div>
          <label className="toggle-row">
            <input type="checkbox" checked={locationAck} onChange={(e) => setLocationAck(e.target.checked)} />
          </label>
        </article>

        <article className="consent-item">
          <ShieldCheck size={22} />
          <div>
            <strong>{t("consent_privacyTitle")}</strong>
            <p>
              {t("consent_privacyBody")}{" "}
              <Link to="/privacy" target="_blank" rel="noreferrer">
                {t("consent_privacyPolicy")}
              </Link>{" "}
              {t("consent_and")}{" "}
              <Link to="/terms" target="_blank" rel="noreferrer">
                {t("consent_terms")}
              </Link>
              .
            </p>
          </div>
          <label className="toggle-row">
            <input type="checkbox" checked={privacyAck} onChange={(e) => setPrivacyAck(e.target.checked)} />
          </label>
        </article>

        <Button
          disabled={!canContinue}
          onClick={accept}
        >
          {t("consent_agree")}
        </Button>
      </div>
    </Modal>
  );
}
